// backend/src/routes/ai.ts
import express, { Request, Response } from 'express';
import { GeminiService } from '../services/geminiService';
import { ActionExecutor } from '../services/actionExecutor';
import { AppState } from '../types';

const router = express.Router();

/**
 * POST /api/ai/execute
 * Main endpoint: Parse natural language command → execute actions
 */
router.post('/execute', async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { userMessage, appState, composeData } = req.body;

    if (!userMessage) {
      return res.status(400).json({ success: false, error: 'userMessage is required' });
    }

    if (!appState) {
      return res.status(400).json({ success: false, error: 'appState is required' });
    }

    console.log(`[AI] User ${req.user.id}: "${userMessage}"`);

    // Get action plan from Gemini
    const geminiService = new GeminiService();
    const actionPlan = await geminiService.executeCommand(userMessage, appState as AppState);

    console.log(`[AI] Generated ${actionPlan.actions.length} actions:`, actionPlan.actions.map(a => a.type));

    // Filter valid actions
    const validActions = actionPlan.actions.filter(action => ActionExecutor.validateAction(action));

    // Execute server-side actions (search, submit/send, openEmail)
    const executedPlan = await ActionExecutor.executeActions(
      validActions,
      req.user.id,
      appState as AppState,
      composeData
    );

    res.json({
      success: true,
      data: {
        reasoning: actionPlan.reasoning,
        actions: executedPlan.actions,
      },
    });
  } catch (error) {
    console.error('[AI] Error:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    });
  }
});

/**
 * GET /api/ai/health
 * Check AI service status
 */
router.get('/health', (req: Request, res: Response) => {
  const geminiApiKey = process.env.GEMINI_API_KEY ? 'configured' : 'missing';
  res.json({
    success: true,
    status: 'ok',
    gemini: { apiKey: geminiApiKey },
  });
});

/**
 * POST /api/ai/test
 * Test Gemini connection
 */
router.post('/test', async (req: Request, res: Response) => {
  try {
    const geminiService = new GeminiService();
    const testState: AppState = {
      currentView: 'inbox',
      emails: [],
      filters: {},
      unreadCount: 0,
    };

    const result = await geminiService.executeCommand('Say hello', testState);

    res.json({
      success: true,
      data: result,
      message: 'Gemini API is working',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
      message: 'Failed to connect to Gemini API',
    });
  }
});

/**
 * POST /api/ai/suggestions
 * Generate 3 custom smart reply suggestions based on email content
 */
router.post('/suggestions', async (req: Request, res: Response) => {
  try {
    const { subject, body } = req.body;
    if (!subject && !body) {
      return res.status(400).json({ success: false, error: 'Subject or body is required' });
    }

    const geminiService = new GeminiService();
    const suggestions = await geminiService.generateSuggestions(subject || '', body || '');
    
    res.json({ success: true, data: suggestions });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

export default router;
