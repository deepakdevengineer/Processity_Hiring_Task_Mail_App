// backend/src/services/gmailService.ts
import { gmail_v1, google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { Email, EmailFilters } from '../types';
import { AuthService } from './authService';
import { pool } from '../db/postgres';

export class GmailService {
  private gmail!: gmail_v1.Gmail;
  public isSandboxMode = false;
  public isSmtpMode = false;
  public sandboxUserId = 0;
  public sandboxUserEmail = '';

  constructor(private oauth2Client: OAuth2Client) {
    if (oauth2Client) {
      this.gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    }
  }

  /**
   * Get Gmail service instance for a user
   */
  static async forUser(userId: number): Promise<GmailService> {
    const user = await AuthService.getUserById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const isSandbox = user.access_token === 'sandbox_access_token_mock';
    if (isSandbox) {
      const service = new GmailService(null as any);
      service.isSandboxMode = true;
      service.sandboxUserId = userId;
      service.sandboxUserEmail = user.email;
      
      // If SMTP credentials are configured in env, activate live SMTP/IMAP mode
      if (process.env.SMTP_EMAIL && process.env.SMTP_PASSWORD) {
        service.isSmtpMode = true;
      }
      return service;
    }

    const oauth2Client = await AuthService.getOAuth2Client(userId);
    return new GmailService(oauth2Client);
  }

  /**
   * Fetch real emails from IMAP using node-imapflow and parse with simpleParser
   */
  async fetchImapEmails(mailboxName: 'INBOX' | 'SENT', limit = 20): Promise<Email[]> {
    const { ImapFlow } = require('imapflow');
    const { simpleParser } = require('mailparser');

    const client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: {
        user: this.sandboxUserEmail || process.env.SMTP_EMAIL,
        pass: process.env.SMTP_PASSWORD
      },
      logger: false
    });

    const parsedEmails: Email[] = [];

    try {
      await client.connect();
      
      // In Gmail IMAP, Sent Mail is typically under [Gmail]/Sent Mail
      const mailboxPath = mailboxName === 'SENT' ? '[Gmail]/Sent Mail' : 'INBOX';
      
      const lock = await client.getMailboxLock(mailboxPath);
      try {
        const mailboxStatus = await client.status(mailboxPath, { messages: true });
        const totalMessages = mailboxStatus.messages || 0;

        if (totalMessages > 0) {
          const startIdx = Math.max(1, totalMessages - limit + 1);
          const range = `${startIdx}:${totalMessages}`;

          for await (const message of client.fetch(range, { source: true, flags: true })) {
            try {
              const parsed = await simpleParser(message.source);
              
              const fromAddress = parsed.from?.value?.[0]?.address || parsed.from?.text || 'unknown@example.com';
              const fromName = parsed.from?.value?.[0]?.name || '';
              const displayFrom = fromName ? `"${fromName}" <${fromAddress}>` : fromAddress;

              const toAddresses = parsed.to ? (Array.isArray(parsed.to) ? parsed.to : [parsed.to]).flatMap(t => 
                t.value ? t.value.map(val => val.address || '') : []
              ).filter(Boolean) : [];

              const subject = parsed.subject || '(No Subject)';
              const body = parsed.html || parsed.text || '';
              
              const emailDate = parsed.date || new Date();
              const isRead = message.flags.has('\\Seen');
              const messageUid = message.uid || message.seq;

              parsedEmails.push({
                id: `imap_${messageUid}`,
                user_id: this.sandboxUserId,
                from_address: displayFrom,
                to_addresses: toAddresses,
                subject,
                body,
                thread_id: `thread_${messageUid}`,
                is_read: isRead,
                is_sent: mailboxName === 'SENT',
                date: emailDate,
                gmail_message_id: parsed.messageId || `imap_${messageUid}`,
                created_at: new Date(),
                updated_at: new Date()
              });
            } catch (parseErr) {
              console.error('Error parsing IMAP email source:', parseErr);
            }
          }
        }
      } finally {
        lock.release();
      }

      await client.logout();
    } catch (err) {
      console.error('IMAP fetch emails failed:', err);
    }

    return parsedEmails.sort((a, b) => b.date.getTime() - a.date.getTime());
  }

  /**
   * Sync IMAP emails to local database cache
   */
  async syncImapEmails(mailbox: 'INBOX' | 'SENT', limit = 20): Promise<Email[]> {
    const emails = await this.fetchImapEmails(mailbox, limit);
    for (const email of emails) {
      try {
        await pool.query(
          `INSERT INTO emails (id, user_id, from_address, to_addresses, subject, body, thread_id, is_read, is_sent, date, gmail_message_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (id) DO UPDATE
           SET is_read = $8, body = $6, updated_at = NOW()`,
          [
            email.id,
            this.sandboxUserId,
            email.from_address,
            email.to_addresses,
            email.subject,
            email.body,
            email.thread_id,
            email.is_read,
            email.is_sent,
            email.date,
            email.gmail_message_id
          ]
        );
      } catch (err) {
        console.error('Failed to sync IMAP email to DB:', err);
      }
    }
    return emails;
  }

  /**
   * Send email using SMTP
   */
  async sendSmtpEmail(to: string, subject: string, body: string, cc?: string[], bcc?: string[]): Promise<string> {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: this.sandboxUserEmail || process.env.SMTP_EMAIL,
        pass: process.env.SMTP_PASSWORD
      }
    });

    const info = await transporter.sendMail({
      from: this.sandboxUserEmail || process.env.SMTP_EMAIL,
      to,
      subject,
      text: body,
      html: body.includes('<') ? body : undefined,
      cc,
      bcc
    });

    return info.messageId || `smtp_${Date.now()}`;
  }

  /**
   * Add seen flag to IMAP server in background
   */
  async setImapSeenFlag(uid: number): Promise<void> {
    const { ImapFlow } = require('imapflow');
    const client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: {
        user: this.sandboxUserEmail || process.env.SMTP_EMAIL,
        pass: process.env.SMTP_PASSWORD
      },
      logger: false
    });

    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      try {
        await client.messageFlagsAdd({ uid }, ['\\Seen']);
      } finally {
        lock.release();
      }
      await client.logout();
    } catch (err) {
      console.error('Failed to set IMAP flag:', err);
    }
  }

  /**
   * List emails from inbox
   */
  async listInbox(limit = 20, pageToken?: string): Promise<{ emails: Email[]; nextPageToken?: string }> {
    if (this.isSandboxMode) {
      if (this.isSmtpMode) {
        // Sync IMAP in background asynchronously so listInbox returns instantly
        this.syncImapEmails('INBOX', limit).catch(err => {
          console.error('Failed to sync IMAP inbox in background:', err);
        });
      }

      try {
        const result = await pool.query(
          'SELECT * FROM emails WHERE user_id = $1 AND is_sent = false ORDER BY date DESC LIMIT $2',
          [this.sandboxUserId, limit]
        );
        return {
          emails: result.rows.map(row => ({
            ...row,
            to_addresses: row.to_addresses || []
          })) as Email[]
        };
      } catch (err) {
        console.error('Sandbox listInbox error:', err);
        throw err;
      }
    }

    try {
      const response = await this.gmail.users.messages.list({
        userId: 'me',
        q: 'is:inbox',
        maxResults: limit,
        pageToken,
        includeSpamTrash: false,
      });

      const messages = response.data.messages || [];
      const emails = await Promise.all(
        messages.map(m => this.getEmailDetails(m.id!))
      );

      return {
        emails: emails.filter(Boolean) as Email[],
        nextPageToken: response.data.nextPageToken || undefined,
      };
    } catch (error) {
      console.error('Error listing inbox:', error);
      throw new Error(`Failed to list inbox: ${(error as Error).message}`);
    }
  }

  /**
   * List sent emails
   */
  async listSent(limit = 20, pageToken?: string): Promise<{ emails: Email[]; nextPageToken?: string }> {
    if (this.isSandboxMode) {
      if (this.isSmtpMode) {
        // Sync IMAP in background asynchronously so listSent returns instantly
        this.syncImapEmails('SENT', limit).catch(err => {
          console.error('Failed to sync IMAP sent in background:', err);
        });
      }

      try {
        const result = await pool.query(
          'SELECT * FROM emails WHERE user_id = $1 AND is_sent = true ORDER BY date DESC LIMIT $2',
          [this.sandboxUserId, limit]
        );
        return {
          emails: result.rows.map(row => ({
            ...row,
            to_addresses: row.to_addresses || []
          })) as Email[]
        };
      } catch (err) {
        console.error('Sandbox listSent error:', err);
        throw err;
      }
    }

    try {
      const response = await this.gmail.users.messages.list({
        userId: 'me',
        q: 'is:sent',
        maxResults: limit,
        pageToken,
      });

      const messages = response.data.messages || [];
      const emails = await Promise.all(
        messages.map(m => this.getEmailDetails(m.id!, true))
      );

      return {
        emails: emails.filter(Boolean) as Email[],
        nextPageToken: response.data.nextPageToken || undefined,
      };
    } catch (error) {
      console.error('Error listing sent:', error);
      throw new Error(`Failed to list sent: ${(error as Error).message}`);
    }
  }

  /**
   * Get detailed email information
   */
  async getEmailDetails(messageId: string, isSent = false): Promise<Email | null> {
    if (this.isSandboxMode) {
      try {
        const result = await pool.query(
          'SELECT * FROM emails WHERE id = $1',
          [messageId]
        );
        if (result.rows.length === 0) return null;
        const row = result.rows[0];
        return {
          ...row,
          to_addresses: row.to_addresses || []
        } as Email;
      } catch (err) {
        console.error('Sandbox getEmailDetails error:', err);
        return null;
      }
    }

    try {
      const response = await this.gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      });

      const message = response.data;
      const headers = message.payload?.headers || [];
      const body = this.extractBody(message.payload);

      return {
        id: message.id!,
        user_id: 0, // Will be set by caller
        from_address: this.getHeader(headers, 'from'),
        to_addresses: this.getHeader(headers, 'to').split(',').map(e => e.trim()).filter(Boolean),
        subject: this.getHeader(headers, 'subject') || '(no subject)',
        body,
        thread_id: message.threadId || '',
        is_read: !message.labelIds?.includes('UNREAD'),
        is_sent: isSent || message.labelIds?.includes('SENT') || false,
        date: new Date(parseInt(message.internalDate || '0')),
        gmail_message_id: message.id!,
        created_at: new Date(),
        updated_at: new Date(),
      };
    } catch (error) {
      console.error('Error getting email details:', error);
      return null;
    }
  }

  /**
   * Send an email
   */
  async sendEmail(to: string, subject: string, body: string, cc?: string[], bcc?: string[]): Promise<string> {
    if (this.isSandboxMode) {
      try {
        let msgId = `msg_sandbox_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        
        if (this.isSmtpMode) {
          msgId = await this.sendSmtpEmail(to, subject, body, cc, bcc);
        }

        // Insert sent email record
        await pool.query(
          `INSERT INTO emails (id, user_id, from_address, to_addresses, subject, body, thread_id, is_read, is_sent, date, gmail_message_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10)
           ON CONFLICT (gmail_message_id) DO NOTHING`,
          [msgId, this.sandboxUserId, this.sandboxUserEmail, [to], subject, body, `thread_${msgId}`, true, true, msgId]
        );

        // If sending to oneself in mock database mode (non-SMTP) also simulate receiving
        if (!this.isSmtpMode && (to === this.sandboxUserEmail || to.includes('sandbox'))) {
          const recvMsgId = `msg_sandbox_recv_${Date.now()}`;
          await pool.query(
            `INSERT INTO emails (id, user_id, from_address, to_addresses, subject, body, thread_id, is_read, is_sent, date, gmail_message_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10)`,
            [recvMsgId, this.sandboxUserId, 'sandbox-sender@mailai.com', [to], subject, body, `thread_${msgId}`, false, false, recvMsgId]
          );
        }
        
        return msgId;
      } catch (err) {
        console.error('Sandbox sendEmail error:', err);
        throw err;
      }
    }

    try {
      const email = this.createEmailMessage(to, subject, body, cc, bcc);

      const response = await this.gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: email,
        },
      });

      return response.data.id || '';
    } catch (error) {
      console.error('Error sending email:', error);
      throw new Error(`Failed to send email: ${(error as Error).message}`);
    }
  }

  /**
   * Search emails with query and filters
   */
  async searchEmails(query: string, filters?: EmailFilters, limit = 20): Promise<Email[]> {
    if (this.isSandboxMode) {
      try {
        let sql = 'SELECT * FROM emails WHERE user_id = $1';
        const params: any[] = [this.sandboxUserId];
        let paramIdx = 2;

        if (filters?.isRead !== undefined) {
          const isReadBool = typeof filters.isRead === 'string'
            ? filters.isRead === 'true'
            : !!filters.isRead;
          sql += ` AND is_read = $${paramIdx++}`;
          params.push(isReadBool);
        }

        if (filters?.dateRange) {
          const match = filters.dateRange.match(/^(\d+)d$/);
          if (match) {
            const days = parseInt(match[1]);
            sql += ` AND date >= NOW() - CAST($${paramIdx++} AS INTERVAL)`;
            params.push(`${days} days`);
          }
        }

        if (filters?.sender) {
          sql += ` AND from_address ILIKE $${paramIdx++}`;
          params.push(`%${filters.sender}%`);
        }

        if (filters?.keyword) {
          sql += ` AND (subject ILIKE $${paramIdx} OR body ILIKE $${paramIdx})`;
          paramIdx++;
          params.push(`%${filters.keyword}%`);
        }

        if (query && query.trim() !== 'is:inbox') {
          const cleanQuery = query.trim();
          if (cleanQuery.toLowerCase() === 'is:unread') {
            sql += ` AND is_read = false`;
          } else if (cleanQuery.toLowerCase() === 'is:read') {
            sql += ` AND is_read = true`;
          } else {
            sql += ` AND (subject ILIKE $${paramIdx} OR body ILIKE $${paramIdx} OR from_address ILIKE $${paramIdx})`;
            paramIdx++;
            params.push(`%${cleanQuery}%`);
          }
        }

        sql += ` ORDER BY date DESC LIMIT $${paramIdx}`;
        params.push(limit);

        const result = await pool.query(sql, params);
        return result.rows.map(row => ({
          ...row,
          to_addresses: row.to_addresses || []
        })) as Email[];
      } catch (err) {
        console.error('Sandbox searchEmails error:', err);
        throw err;
      }
    }

    try {
      let q = query || '';

      // Add filters to query
      if (filters?.dateRange) {
        const date = this.getDateFilter(filters.dateRange);
        q += ` after:${date}`;
      }

      if (filters?.sender) {
        q += ` from:${filters.sender}`;
      }

      if (filters?.keyword) {
        q += ` ${filters.keyword}`;
      }

      if (filters?.isRead !== undefined) {
        q += filters.isRead ? ' is:read' : ' is:unread';
      }

      const response = await this.gmail.users.messages.list({
        userId: 'me',
        q: q.trim() || 'is:inbox',
        maxResults: limit,
      });

      const messages = response.data.messages || [];
      const emails = await Promise.all(
        messages.map(m => this.getEmailDetails(m.id!))
      );

      return emails.filter(Boolean) as Email[];
    } catch (error) {
      console.error('Error searching emails:', error);
      throw new Error(`Failed to search emails: ${(error as Error).message}`);
    }
  }

  /**
   * Mark email as read
   */
  async markAsRead(messageId: string): Promise<void> {
    if (this.isSandboxMode) {
      try {
        await pool.query(
          'UPDATE emails SET is_read = true, updated_at = NOW() WHERE id = $1',
          [messageId]
        );

        if (this.isSmtpMode && messageId.startsWith('imap_')) {
          const uid = parseInt(messageId.split('_')[1]);
          if (!isNaN(uid)) {
            this.setImapSeenFlag(uid).catch(err => console.error('Failed to set IMAP Seen flag:', err));
          }
        }
        return;
      } catch (err) {
        console.error('Sandbox markAsRead error:', err);
        return;
      }
    }

    try {
      await this.gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: {
          removeLabelIds: ['UNREAD'],
        },
      });
    } catch (error) {
      console.error('Error marking email as read:', error);
    }
  }

  /**
   * Delete email (move to trash)
   */
  async deleteEmail(messageId: string): Promise<void> {
    if (this.isSandboxMode) {
      try {
        await pool.query(
          'DELETE FROM emails WHERE id = $1',
          [messageId]
        );
        return;
      } catch (err) {
        console.error('Sandbox deleteEmail error:', err);
        throw err;
      }
    }

    try {
      await this.gmail.users.messages.trash({
        userId: 'me',
        id: messageId,
      });
    } catch (error) {
      console.error('Error deleting email:', error);
      throw new Error(`Failed to delete email: ${(error as Error).message}`);
    }
  }

  /**
   * Reply to an email
   */
  async replyToEmail(originalEmail: Email, body: string): Promise<string> {
    if (this.isSandboxMode) {
      try {
        let msgId = `msg_sandbox_reply_${Date.now()}`;
        
        if (this.isSmtpMode) {
          msgId = await this.sendSmtpEmail(originalEmail.from_address, `Re: ${originalEmail.subject}`, body);
        }

        await pool.query(
          `INSERT INTO emails (id, user_id, from_address, to_addresses, subject, body, thread_id, is_read, is_sent, date, gmail_message_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10)
           ON CONFLICT (gmail_message_id) DO NOTHING`,
          [msgId, this.sandboxUserId, this.sandboxUserEmail, [originalEmail.from_address], `Re: ${originalEmail.subject}`, body, originalEmail.thread_id, true, true, msgId]
        );
        return msgId;
      } catch (err) {
        console.error('Sandbox replyToEmail error:', err);
        throw err;
      }
    }

    try {
      const email = this.createReplyMessage(originalEmail, body);
      const response = await this.gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: email,
          threadId: originalEmail.thread_id,
        },
      });
      return response.data.id || '';
    } catch (error) {
      throw new Error(`Failed to reply: ${(error as Error).message}`);
    }
  }

  // ── Helper Methods ──────────────────────────────────────────

  private getHeader(headers: any[], name: string): string {
    return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
  }

  private extractBody(payload: any): string {
    if (!payload) return '';

    if (payload.mimeType === 'text/plain') {
      return this.decodeData(payload.body?.data);
    }

    if (payload.mimeType === 'text/html') {
      return this.decodeData(payload.body?.data);
    }

    if (payload.parts) {
      const htmlPart = payload.parts.find((p: any) => p.mimeType === 'text/html');
      if (htmlPart) return this.decodeData(htmlPart.body?.data);

      const textPart = payload.parts.find((p: any) => p.mimeType === 'text/plain');
      if (textPart) return this.decodeData(textPart.body?.data);

      for (const part of payload.parts) {
        if (part.parts) {
          const nestedHtml = part.parts.find((p: any) => p.mimeType === 'text/html');
          if (nestedHtml) return this.decodeData(nestedHtml.body?.data);
          const nestedText = part.parts.find((p: any) => p.mimeType === 'text/plain');
          if (nestedText) return this.decodeData(nestedText.body?.data);
        }
      }
    }

    return payload.body?.data ? this.decodeData(payload.body.data) : '(no content)';
  }

  private decodeData(data?: string): string {
    if (!data) return '';
    try {
      return Buffer.from(data, 'base64').toString('utf-8');
    } catch {
      return data;
    }
  }

  private createEmailMessage(to: string, subject: string, body: string, cc?: string[], bcc?: string[]): string {
    const lines = [
      'From: me',
      `To: ${to}`,
      ...(cc && cc.length > 0 ? [`Cc: ${cc.join(',')}`] : []),
      ...(bcc && bcc.length > 0 ? [`Bcc: ${bcc.join(',')}`] : []),
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      body,
    ];

    return Buffer.from(lines.join('\r\n')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  }

  private createReplyMessage(originalEmail: Email, body: string): string {
    const lines = [
      `To: ${originalEmail.from_address}`,
      `Subject: Re: ${originalEmail.subject}`,
      `In-Reply-To: ${originalEmail.gmail_message_id}`,
      `References: ${originalEmail.gmail_message_id}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      body,
      '',
      `On ${new Date(originalEmail.date).toLocaleString()}, ${originalEmail.from_address} wrote:`,
      ...originalEmail.body.split('\n').map(l => `> ${l}`),
    ];

    return Buffer.from(lines.join('\r\n')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  }

  private getDateFilter(dateRange: string): string {
    const now = new Date();
    let targetDate = new Date();

    if (dateRange.endsWith('d')) {
      const days = parseInt(dateRange);
      targetDate.setDate(now.getDate() - days);
    } else {
      targetDate = new Date(dateRange);
    }

    return targetDate.toISOString().split('T')[0];
  }
}
