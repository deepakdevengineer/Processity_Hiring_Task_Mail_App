// backend/src/services/schedulerService.ts
import { pool } from '../db/postgres';
import { GmailService } from './gmailService';

export class SchedulerService {
  private static pollerInterval: NodeJS.Timeout | null = null;

  /**
   * Start the background poller to process scheduled emails
   */
  static startPoller() {
    if (this.pollerInterval) return;

    console.log('⏰ Starting background Email Scheduler poller...');
    
    // Check every 15 seconds
    this.pollerInterval = setInterval(async () => {
      try {
        await this.processScheduledEmails();
      } catch (err) {
        console.error('Error in Email Scheduler poller:', err);
      }
    }, 15000);
  }

  /**
   * Stop the poller
   */
  static stopPoller() {
    if (this.pollerInterval) {
      clearInterval(this.pollerInterval);
      this.pollerInterval = null;
      console.log('⏰ Stopped background Email Scheduler poller.');
    }
  }

  /**
   * Add a new scheduled email to the database
   */
  static async scheduleEmail(
    userId: number,
    toAddress: string,
    subject: string,
    body: string,
    scheduledAt: Date
  ) {
    const query = `
      INSERT INTO scheduled_emails (user_id, to_address, subject, body, scheduled_at, status)
      VALUES ($1, $2, $3, $4, $5, 'pending')
      RETURNING *
    `;
    const result = await pool.query(query, [userId, toAddress, subject, body, scheduledAt]);
    return result.rows[0];
  }

  /**
   * List scheduled emails for a user
   */
  static async listScheduledEmails(userId: number) {
    const query = `
      SELECT * FROM scheduled_emails
      WHERE user_id = $1
      ORDER BY scheduled_at ASC
    `;
    const result = await pool.query(query, [userId]);
    return result.rows;
  }

  /**
   * Delete/Cancel a scheduled email
   */
  static async deleteScheduledEmail(id: number, userId: number) {
    const query = `
      DELETE FROM scheduled_emails
      WHERE id = $1 AND user_id = $2 AND status = 'pending'
      RETURNING *
    `;
    const result = await pool.query(query, [id, userId]);
    return result.rowCount > 0;
  }

  /**
   * Process all pending scheduled emails whose time has come
   */
  private static async processScheduledEmails() {
    // Select all pending scheduled emails that are due
    const selectQuery = `
      SELECT * FROM scheduled_emails
      WHERE status = 'pending' AND scheduled_at <= NOW()
      FOR UPDATE SKIP LOCKED
    `;
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query(selectQuery);
      const pendingEmails = res.rows;

      if (pendingEmails.length === 0) {
        await client.query('COMMIT');
        return;
      }

      console.log(`⏰ Processing ${pendingEmails.length} due scheduled email(s)...`);

      for (const email of pendingEmails) {
        try {
          // Instantiate GmailService for the user
          const gmailService = await GmailService.forUser(email.user_id);
          
          // Send the email
          await gmailService.sendEmail(email.to_address, email.subject, email.body);

          // Update status to 'sent'
          await client.query(
            `UPDATE scheduled_emails SET status = 'sent', updated_at = NOW() WHERE id = $1`,
            [email.id]
          );
          console.log(`✅ Successfully sent scheduled email ID ${email.id} to ${email.to_address}`);
        } catch (sendErr) {
          console.error(`❌ Failed to send scheduled email ID ${email.id}:`, sendErr);
          const errorMsg = (sendErr as Error).message || String(sendErr);
          // Update status to 'failed' with error message
          await client.query(
            `UPDATE scheduled_emails SET status = 'failed', error_message = $2, updated_at = NOW() WHERE id = $1`,
            [email.id, errorMsg]
          );
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
