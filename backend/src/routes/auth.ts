// backend/src/routes/auth.ts
import express, { Request, Response } from 'express';
import { AuthService } from '../services/authService';
import { authMiddleware } from '../middleware/auth';

const router = express.Router();

/**
 * GET /auth/login
 * Initiates Google OAuth flow - returns auth URL
 */
router.get('/login', (req: Request, res: Response) => {
  try {
    const authUrl = AuthService.getAuthUrl();
    res.json({ url: authUrl });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * GET /auth/google/callback
 * Handles OAuth callback from Google
 */
router.get('/google/callback', async (req: Request, res: Response) => {
  try {
    const { code, error: oauthError } = req.query;

    if (oauthError) {
      return res.redirect(
        `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=${encodeURIComponent(oauthError as string)}`
      );
    }

    if (!code) {
      return res.redirect(
        `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=No authorization code`
      );
    }

    // Exchange code for tokens
    const tokens = await AuthService.exchangeCodeForToken(code as string);

    // Get user info
    const googleUser = await AuthService.getUserInfo(tokens.access_token);

    // Create or update user in database
    const user = await AuthService.upsertUser(
      googleUser.id,
      googleUser.email,
      tokens.access_token,
      tokens.refresh_token
    );

    // Generate JWT
    const jwtToken = AuthService.generateJWT(user);

    // Set HTTP-only cookie with JWT
    res.cookie('auth_token', jwtToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });

    // Redirect to frontend callback with token
    const redirectUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/callback?token=${jwtToken}`;
    res.redirect(redirectUrl);
  } catch (error) {
    console.error('OAuth callback error:', error);
    const errorMessage = (error as Error).message;
    res.redirect(
      `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=${encodeURIComponent(errorMessage)}`
    );
  }
});

/**
 * GET /auth/me
 * Get current user info (requires auth)
 */
router.get('/me', authMiddleware, async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = await AuthService.getUserById(req.user.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      id: user.id,
      email: user.email,
      google_id: user.google_id,
      created_at: user.created_at,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * POST /auth/logout
 * Logout user
 */
router.post('/logout', (req: Request, res: Response) => {
  res.clearCookie('auth_token');
  res.json({ success: true, message: 'Logged out' });
});

/**
 * GET /auth/verify
 * Verify if token is valid
 */
router.get('/verify', (req: Request, res: Response) => {
  try {
    const token = req.cookies?.auth_token || req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({ valid: false });
    }

    const user = AuthService.verifyJWT(token);

    if (!user) {
      return res.status(401).json({ valid: false });
    }

    res.json({ valid: true, user });
  } catch (error) {
    res.status(401).json({ valid: false, error: (error as Error).message });
  }
});

/**
 * POST /api/auth/sandbox
 * Bypasses Google OAuth and logs in using a mock local developer sandbox user.
 * Seeds mock emails if database table is empty.
 */
router.post('/sandbox', async (req: Request, res: Response) => {
  try {
    const { pool } = require('../db/postgres');
    
    // Use SMTP_EMAIL if configured, otherwise fallback to offline sandbox mode
    const sandboxEmail = process.env.SMTP_EMAIL || 'sandbox@mailai.com';

    // 1. Create or get sandbox user
    const sandboxUser = await AuthService.upsertUser(
      'sandbox_oauth_id_999',
      sandboxEmail,
      'sandbox_access_token_mock',
      'sandbox_refresh_token_mock'
    );

    // 2. Clear out any previous mock emails to prevent duplicates or seed fresh ones
    const emailCheck = await pool.query('SELECT COUNT(*) FROM emails WHERE user_id = $1', [sandboxUser.id]);
    if (parseInt(emailCheck.rows[0].count) === 0) {
      await pool.query(
        `INSERT INTO emails (id, user_id, from_address, to_addresses, subject, body, thread_id, is_read, is_sent, date)
         VALUES 
         ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW() - INTERVAL '2 hours'),
         ($10, $11, $12, $13, $14, $15, $16, $17, $18, NOW() - INTERVAL '1 day'),
         ($19, $20, $21, $22, $23, $24, $25, $26, $27, NOW() - INTERVAL '2 days')`,
        [
          'msg_mock_1', sandboxUser.id, 'sarah.jones@example.com', [sandboxEmail], 'Project Update & Milestones', 'Hi team,\n\nHere is the quick update on our milestones. The backend deployment is 90% complete and we are ready for user testing. Let me know if you want to review the code tomorrow.\n\nBest,\nSarah', 'thread_mock_1', false, false,
          'msg_mock_2', sandboxUser.id, 'david.miller@example.com', [sandboxEmail], 'Meeting Agenda for syncup', 'Hey, we need to sync up about design system edits. Let us meet tomorrow at 3pm to align on custom variables.\n\nCheers,\nDavid', 'thread_mock_2', false, false,
          'msg_mock_3', sandboxUser.id, 'newsletter@zomato.com', [sandboxEmail], 'Your Weekly Food Summary', 'Hello Foodie!\n\nHere are your top choices this week. Use code GOURMET for 20% off on your next order.\n\nSincerely,\nZomato Delivery', 'thread_mock_3', true, false
        ]
      );
    }

    // 3. Generate JWT
    const jwtToken = AuthService.generateJWT(sandboxUser);

    // 4. Set cookie
    res.cookie('auth_token', jwtToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.json({
      success: true,
      token: jwtToken,
      user: {
        id: sandboxUser.id,
        email: sandboxUser.email,
        google_id: sandboxUser.google_id
      }
    });
  } catch (error) {
    console.error('Sandbox login error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
