// backend/src/routes/emails.ts
import express, { Request, Response } from 'express';
import { SendEmailRequest, SearchEmailsRequest } from '../types';
import { GmailService } from '../services/gmailService';
import { SchedulerService } from '../services/schedulerService';

const router = express.Router();

/**
 * GET /api/emails/inbox
 * List inbox emails
 */
router.get('/inbox', async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const limit = parseInt(req.query.limit as string) || 20;
    const gmailService = await GmailService.forUser(req.user.id);
    const { emails } = await gmailService.listInbox(limit);
    const withUserId = emails.map(e => ({ ...e, user_id: req.user!.id }));

    res.json({ success: true, data: withUserId, count: withUserId.length });
  } catch (error) {
    console.error('Inbox error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * GET /api/emails/sent
 * List sent emails
 */
router.get('/sent', async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const limit = parseInt(req.query.limit as string) || 20;
    const gmailService = await GmailService.forUser(req.user.id);
    const { emails } = await gmailService.listSent(limit);
    const withUserId = emails.map(e => ({ ...e, user_id: req.user!.id }));

    res.json({ success: true, data: withUserId, count: withUserId.length });
  } catch (error) {
    console.error('Sent error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * GET /api/emails/scheduled
 * List all scheduled emails for the user
 * NOTE: MUST BE DEFINED BEFORE /:id ROUTE TO PREVENT ROUTING CONFLICTS
 */
router.get('/scheduled', async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const list = await SchedulerService.listScheduledEmails(req.user.id);
    res.json({ success: true, data: list });
  } catch (error) {
    console.error('List scheduled emails error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * DELETE /api/emails/scheduled/:id
 * Cancel/delete a pending scheduled email
 * NOTE: MUST BE DEFINED BEFORE /:id ROUTE TO PREVENT ROUTING CONFLICTS
 */
router.delete('/scheduled/:id', async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid scheduled email ID' });
    }

    const deleted = await SchedulerService.deleteScheduledEmail(id, req.user.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Scheduled email not found or already processed' });
    }

    res.json({ success: true, message: 'Scheduled email cancelled successfully' });
  } catch (error) {
    console.error('Delete scheduled email error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * POST /api/emails/schedule
 * Schedule an email for later sending
 * NOTE: MUST BE DEFINED BEFORE /:id ROUTE TO PREVENT ROUTING CONFLICTS
 */
router.post('/schedule', async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const { to, subject, body, scheduledAt } = req.body;

    if (!to || !subject || !body || !scheduledAt) {
      return res.status(400).json({ success: false, error: 'Missing required fields: to, subject, body, scheduledAt' });
    }

    const scheduledDate = new Date(scheduledAt);
    if (isNaN(scheduledDate.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid scheduledAt date format' });
    }

    if (scheduledDate <= new Date()) {
      return res.status(400).json({ success: false, error: 'Scheduled time must be in the future' });
    }

    const scheduledEmail = await SchedulerService.scheduleEmail(
      req.user.id,
      to,
      subject,
      body,
      scheduledDate
    );

    res.json({ success: true, data: scheduledEmail, message: `Email scheduled to be sent at ${scheduledDate.toISOString()}` });
  } catch (error) {
    console.error('Schedule email error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * POST /api/emails/send
 * Send an email
 */
router.post('/send', async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const { to, subject, body, cc, bcc } = req.body as SendEmailRequest;

    if (!to || !subject || body === undefined) {
      return res.status(400).json({ success: false, error: 'Missing required fields: to, subject, body' });
    }

    const gmailService = await GmailService.forUser(req.user.id);
    const messageId = await gmailService.sendEmail(to, subject, body, cc, bcc);

    res.json({ success: true, data: { messageId, message: `Email sent to ${to}` } });
  } catch (error) {
    console.error('Send error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * POST /api/emails/search
 * Search emails
 */
router.post('/search', async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const { query, filters, limit } = req.body as SearchEmailsRequest;
    const gmailService = await GmailService.forUser(req.user.id);
    const emails = await gmailService.searchEmails(query || '', filters, limit || 20);
    const withUserId = emails.map(e => ({ ...e, user_id: req.user!.id }));

    res.json({ success: true, data: withUserId, count: withUserId.length });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * GET /api/emails/:id
 * Get email details
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const { id } = req.params;
    const gmailService = await GmailService.forUser(req.user.id);
    const email = await gmailService.getEmailDetails(id);

    if (!email) return res.status(404).json({ success: false, error: 'Email not found' });

    email.user_id = req.user.id;
    res.json({ success: true, data: email });
  } catch (error) {
    console.error('Get email error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * POST /api/emails/:id/mark-read
 * Mark email as read
 */
router.post('/:id/mark-read', async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const gmailService = await GmailService.forUser(req.user.id);
    await gmailService.markAsRead(req.params.id);

    res.json({ success: true, message: 'Email marked as read' });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * POST /api/emails/:id/reply
 * Reply to an email
 */
router.post('/:id/reply', async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const { body } = req.body;
    if (!body) return res.status(400).json({ success: false, error: 'Reply body is required' });

    const gmailService = await GmailService.forUser(req.user.id);
    const originalEmail = await gmailService.getEmailDetails(req.params.id);

    if (!originalEmail) return res.status(404).json({ success: false, error: 'Original email not found' });

    originalEmail.user_id = req.user.id;
    const messageId = await gmailService.replyToEmail(originalEmail, body);

    res.json({ success: true, data: { messageId, message: 'Reply sent' } });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * DELETE /api/emails/:id
 * Delete (trash) email
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const gmailService = await GmailService.forUser(req.user.id);
    await gmailService.deleteEmail(req.params.id);

    res.json({ success: true, message: 'Email moved to trash' });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

export default router;
