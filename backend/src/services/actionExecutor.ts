// backend/src/services/actionExecutor.ts
import { AIAction, GeminiResponse, AppState, Email, EmailFilters } from '../types';
import { GmailService } from './gmailService';

export class ActionExecutor {
  /**
   * Execute AI-generated actions server-side
   * Some actions (navigate, fillForm) are passed through to the frontend.
   * Actions like search and submit are executed here.
   */
  static async executeActions(
    actions: AIAction[],
    userId: number,
    appState: AppState,
    composeData?: { to: string; subject: string; body: string; cc?: string[]; bcc?: string[] }
  ): Promise<{ reasoning: string; actions: AIAction[] }> {
    const gmailService = await GmailService.forUser(userId);
    const executedActions: AIAction[] = [];
    let pendingComposeFields: Record<string, string> = {};

    for (const action of actions) {
      try {
        switch (action.type) {
          case 'navigate':
          case 'reply':
          case 'forward':
          case 'delete':
          case 'markRead':
          case 'schedule':
            // Pass through to frontend
            executedActions.push(action);
            break;

          case 'fillForm':
            // Track compose fields for later submit
            if (action.formId === 'composeForm' && action.fields) {
              pendingComposeFields = { ...pendingComposeFields, ...action.fields };
            }
            executedActions.push(action);
            break;

          case 'search': {
            // Execute server-side search
            const searchResults = await gmailService.searchEmails(
              action.query || '',
              action.filters as EmailFilters,
              20
            );
            // Attach results for frontend to display
            const searchAction = { ...action, results: searchResults };
            executedActions.push(searchAction);
            break;
          }

          case 'submit': {
            // Send email using filled form data
            if (action.formId === 'composeForm') {
              // Use either pending compose fields or passed composeData
              const sendData = composeData || pendingComposeFields;
              if (sendData.to && sendData.subject !== undefined && sendData.body !== undefined) {
                try {
                  const messageId = await gmailService.sendEmail(
                    sendData.to,
                    sendData.subject,
                    sendData.body,
                    sendData.cc,
                    sendData.bcc
                  );
                  executedActions.push({
                    ...action,
                    success: true,
                    messageId,
                  });
                } catch (sendErr) {
                  executedActions.push({
                    type: 'message',
                    text: `Failed to send email: ${(sendErr as Error).message}`,
                  });
                }
              } else {
                // No server data — let frontend handle it
                executedActions.push(action);
              }
            } else {
              executedActions.push(action);
            }
            break;
          }

          case 'openEmail': {
            // Fetch email details
            if (action.emailId) {
              const email = await gmailService.getEmailDetails(action.emailId);
              if (email) {
                email.user_id = userId;
                executedActions.push({ ...action, email });
              } else {
                executedActions.push({ type: 'message', text: 'Could not find that email.' });
              }
            }
            break;
          }

          case 'message':
            executedActions.push(action);
            break;

          default:
            console.warn('Unknown action type:', action.type);
            executedActions.push(action);
        }
      } catch (error) {
        console.error(`Error executing action ${action.type}:`, error);
        // Continue with next action instead of failing completely
        executedActions.push({
          type: 'message',
          text: `Error: ${(error as Error).message}`,
        });
      }
    }

    return {
      reasoning: 'Actions executed',
      actions: executedActions,
    };
  }

  /**
   * Build context string from current app state
   */
  static buildContextString(appState: AppState): string {
    let context = `Current View: ${appState.currentView}\n`;

    if (appState.currentEmail) {
      context += `Currently Reading: Email from ${appState.currentEmail.from_address} with subject "${appState.currentEmail.subject}"\n`;
    }

    context += `Total Emails Visible: ${appState.emails.length}\n`;
    context += `Unread Emails: ${appState.unreadCount}\n`;

    if (Object.keys(appState.filters).length > 0) {
      context += `Active Filters: ${JSON.stringify(appState.filters)}\n`;
    }

    return context;
  }

  /**
   * Validate action before execution
   */
  static validateAction(action: AIAction): boolean {
    const validTypes = ['navigate', 'fillForm', 'search', 'submit', 'message', 'openEmail', 'reply', 'forward', 'delete', 'markRead', 'schedule'];
    
    if (!validTypes.includes(action.type)) {
      return false;
    }

    switch (action.type) {
      case 'navigate':
        return action.view && ['inbox', 'sent', 'compose', 'detail', 'scheduled'].includes(action.view);
      case 'fillForm':
        return !!(action.formId && action.fields);
      case 'search':
        return action.query !== undefined;
      case 'submit':
        return true;
      case 'message':
        return action.text !== undefined;
      case 'openEmail':
        return !!action.emailId;
      case 'reply':
      case 'forward':
      case 'delete':
      case 'markRead':
      case 'schedule':
        return true;
      default:
        return false;
    }
  }
}
