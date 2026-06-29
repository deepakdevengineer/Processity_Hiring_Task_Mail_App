// backend/src/services/authService.ts
import axios from 'axios';
import { google } from 'googleapis';
import jwt from 'jsonwebtoken';
import { pool } from '../db/postgres';
import { User, GoogleOAuthTokens, GoogleOAuthUser, AuthUser } from '../types';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

export class AuthService {
  /**
   * Generate Google OAuth authorization URL
   */
  static getAuthUrl(): string {
    const scopes = [
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ];

    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent',
    });
  }

  /**
   * Exchange authorization code for tokens
   */
  static async exchangeCodeForToken(code: string): Promise<GoogleOAuthTokens> {
    try {
      const { tokens } = await oauth2Client.getToken(code);
      
      return {
        access_token: tokens.access_token!,
        refresh_token: tokens.refresh_token || undefined,
        expires_in: tokens.expiry_date || 3600,
        token_type: 'Bearer',
        id_token: tokens.id_token,
      };
    } catch (error) {
      throw new Error(`Failed to exchange code for token: ${(error as Error).message}`);
    }
  }

  /**
   * Get user info from Google
   */
  static async getUserInfo(accessToken: string): Promise<GoogleOAuthUser> {
    try {
      const response = await axios.get(
        'https://www.googleapis.com/oauth2/v2/userinfo',
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get user info: ${(error as Error).message}`);
    }
  }

  /**
   * Create or update user in database
   */
  static async upsertUser(
    googleId: string,
    email: string,
    accessToken: string,
    refreshToken?: string
  ): Promise<User> {
    const expiresAt = new Date(Date.now() + 3600 * 1000); // 1 hour

    const result = await pool.query(
      `INSERT INTO users (google_id, email, access_token, refresh_token, token_expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (google_id) DO UPDATE 
       SET access_token = $3, refresh_token = COALESCE(NULLIF($4, ''), users.refresh_token), 
           token_expires_at = $5, updated_at = NOW()
       RETURNING *`,
      [googleId, email, accessToken, refreshToken || '', expiresAt]
    );

    return result.rows[0] as User;
  }

  /**
   * Get user by ID
   */
  static async getUserById(userId: number): Promise<User | null> {
    const result = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [userId]
    );
    return result.rows[0] || null;
  }

  /**
   * Refresh access token using refresh token
   */
  static async refreshAccessToken(userId: number): Promise<string> {
    const user = await this.getUserById(userId);
    if (!user?.refresh_token) {
      throw new Error('No refresh token available');
    }

    try {
      oauth2Client.setCredentials({
        refresh_token: user.refresh_token,
      });

      const { credentials } = await oauth2Client.refreshAccessToken();
      const newAccessToken = credentials.access_token!;

      // Update token in database
      await pool.query(
        'UPDATE users SET access_token = $1, token_expires_at = $2, updated_at = NOW() WHERE id = $3',
        [newAccessToken, new Date(Date.now() + 3600 * 1000), userId]
      );

      return newAccessToken;
    } catch (error) {
      throw new Error(`Failed to refresh token: ${(error as Error).message}`);
    }
  }

  /**
   * Generate JWT token for session
   */
  static generateJWT(user: User): string {
    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      google_id: user.google_id,
    };

    return jwt.sign(authUser, process.env.JWT_SECRET || 'your-secret-key', {
      expiresIn: '24h',
    } as any);
  }

  /**
   * Verify JWT token
   */
  static verifyJWT(token: string): AuthUser | null {
    try {
      return jwt.verify(
        token,
        process.env.JWT_SECRET || 'your-secret-key'
      ) as AuthUser;
    } catch {
      return null;
    }
  }

  /**
   * Get OAuth client with user's credentials
   */
  static async getOAuth2Client(userId: number) {
    const user = await this.getUserById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Check if token needs refresh
    const now = new Date();
    if (user.token_expires_at && user.token_expires_at < now) {
      const newToken = await this.refreshAccessToken(userId);
      oauth2Client.setCredentials({
        access_token: newToken,
        refresh_token: user.refresh_token,
      });
    } else {
      oauth2Client.setCredentials({
        access_token: user.access_token,
        refresh_token: user.refresh_token,
      });
    }

    return oauth2Client;
  }
}
