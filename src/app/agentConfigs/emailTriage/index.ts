import { RealtimeAgent, tool } from "@openai/agents/realtime";

async function gmailApi(body: Record<string, any>) {
  const res = await fetch("/api/gmail", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export interface EmailData {
  id: string;
  threadId: string;
  from: string;
  to: string;
  cc: string;
  subject: string;
  snippet: string;
  date: string;
  body?: string;
}

export interface EmailTriageDeps {
  emails: () => EmailData[];
  setEmails: (emails: EmailData[]) => void;
  emailIndex: () => number;
  advanceIndex: () => void;
  recordAction: (action: "reply" | "skip" | "archive") => void;
  getActionSummary: () => { replied: number; skipped: number; archived: number };
}

export function createEmailTriageAgent(deps: EmailTriageDeps) {
  return new RealtimeAgent({
    name: "emailTriage",
    voice: "ash",
    handoffDescription: "Voice email triage assistant for hands-free driving",

    instructions: `
# Role
You are a hands-free email assistant designed for someone driving to work. Be concise, conversational, and efficient. The user cannot look at a screen — everything must be communicated by voice.

# CRITICAL RULE
NEVER invent, guess, or assume any email content. You MUST call get_email_count and get_next_email and wait for results before mentioning any sender, subject, or content. If you don't have tool results yet, just say you're checking their inbox — do NOT make up placeholder emails.

# Behavior
1. When the session starts, immediately call get_email_count. While waiting, say something brief like "Hey, let me check your inbox." Once you have the result, announce the count and briefly note which ones look most urgent or important based on the email list returned. For example: "You have 14 unread emails. A couple look urgent — one from your board member and one about a deadline. Let's start with those."
2. Then call get_next_email. Wait for the result before saying anything about the email. Once you have it, read a brief summary: who it's from, the subject, and a 1-2 sentence summary of the content. If threadLength > 1, the body contains the full conversation thread with multiple messages from different people — summarize the whole thread, not just the latest message. For example: "This is a thread with 3 messages. You replied to Harshita about ESTA requirements, and now Yasith is asking about visa specifics." If the user is in the CC or BCC (not in the "to" field), mention that — e.g., "You're CC'd on this one" — since CC'd emails are usually lower priority.
3. After summarizing, ask: "Would you like to reply, skip, or archive this one?"
4. Based on their response:
   - **Reply**: Ask what they'd like to say. Draft the reply, read it back to them, and ask to confirm before sending. If they confirm, call reply_to_email. The email will be automatically archived after sending.
   - **Skip**: Call skip_email and move to the next one.
   - **Archive**: Call archive_email and move to the next one.
5. After each action, automatically call get_next_email for the next one.
6. When get_next_email returns done=true, let them know they're all caught up and give the session summary.
7. When the user says "I'm done", "that's all", "wrap up", or similar, call get_session_summary. Announce it naturally: "All set. You replied to X, skipped Y, and archived Z. You still have N left for later. Have a great day!"

# Prioritization
When you receive the email list from get_email_count, mentally sort them. Present emails in this order:
- URGENT first: direct asks, deadlines, board/investor emails, people issues, anything time-sensitive
- IMPORTANT next: project updates, meeting follow-ups, interesting discussions
- FYI last: newsletters, automated notifications, CC'd threads
You decide the order — use your judgment. The user trusts you to surface the important stuff first.

# Style
- Keep summaries SHORT — sender name, subject, and the key point. Don't read the full email unless asked.
- For senders, just use the name (not the full email address) unless it's unclear.
- Be natural and conversational, like a helpful assistant riding along.
- If the user says something ambiguous, default to the most likely intent (e.g., "next" means skip).
- Don't repeat options every time — just ask "What would you like to do?" after the first couple.
`,

    tools: [
      tool({
        name: "get_email_count",
        description:
          "Get all unread emails from the inbox. Returns the full list with sender, subject, to/cc, and snippet for each email. Call this first so you can tell the user how many emails they have and which ones look urgent.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
        execute: async () => {
          const data = await gmailApi({ action: "list", maxResults: 50 });
          if (data.error) return { error: data.error };
          const emails = data.emails || [];
          deps.setEmails(emails);
          return {
            count: emails.length,
            emails: emails.map((e: any) => ({
              id: e.id,
              from: e.from,
              to: e.to,
              cc: e.cc,
              subject: e.subject,
              snippet: e.snippet,
              date: e.date,
            })),
          };
        },
      }),

      tool({
        name: "get_next_email",
        description:
          "Get the next email to present to the user. Returns the full body text. You decide the order based on your assessment of urgency from the email list.",
        parameters: {
          type: "object",
          properties: {
            email_id: {
              type: "string",
              description:
                "The ID of the email to fetch. Choose based on your priority assessment. If omitted, fetches the next one in list order.",
            },
          },
          required: [],
          additionalProperties: false,
        },
        execute: async (args: any) => {
          const emails = deps.emails();
          if (emails.length === 0) {
            const summary = deps.getActionSummary();
            return {
              done: true,
              message: "No more unread emails.",
              sessionSummary: {
                replied: summary.replied,
                skipped: summary.skipped,
                archived: summary.archived,
                total: summary.replied + summary.skipped + summary.archived,
              },
            };
          }

          // Find the requested email or take the next one
          let emailIdx: number;
          if (args.email_id) {
            emailIdx = emails.findIndex((e) => e.id === args.email_id);
            if (emailIdx === -1) emailIdx = 0;
          } else {
            emailIdx = deps.emailIndex();
            if (emailIdx >= emails.length) {
              const summary = deps.getActionSummary();
              return {
                done: true,
                message: "No more unread emails.",
                sessionSummary: {
                  replied: summary.replied,
                  skipped: summary.skipped,
                  archived: summary.archived,
                  total: summary.replied + summary.skipped + summary.archived,
                },
              };
            }
          }

          const email = emails[emailIdx];
          deps.advanceIndex();

          // Fetch thread context (last 5 messages) so the agent sees the full conversation
          const threadData = await gmailApi({
            action: "readThread",
            threadId: email.threadId,
          });

          const threadMessages = threadData.messages || [];

          // Format thread as a readable conversation for the agent
          let conversationContext = "";
          if (threadMessages.length > 1) {
            conversationContext = threadMessages
              .map((m: any) => `[${m.from}]: ${m.body}`)
              .join("\n---\n");
          } else if (threadMessages.length === 1) {
            conversationContext = threadMessages[0].body;
          } else {
            // Fallback to single message body
            const bodyData = await gmailApi({
              action: "read",
              messageId: email.id,
            });
            conversationContext = bodyData.body || email.snippet;
          }

          return {
            id: email.id,
            threadId: email.threadId,
            from: email.from,
            to: email.to,
            cc: email.cc,
            subject: email.subject,
            date: email.date,
            threadLength: threadMessages.length,
            body: conversationContext,
          };
        },
      }),

      tool({
        name: "reply_to_email",
        description:
          "Send a reply to the current email. Only call this after the user has confirmed the reply text. The email will be automatically archived after sending.",
        parameters: {
          type: "object",
          properties: {
            message_id: {
              type: "string",
              description: "The ID of the email to reply to",
            },
            thread_id: {
              type: "string",
              description: "The thread ID of the email",
            },
            reply_text: {
              type: "string",
              description: "The text content of the reply",
            },
          },
          required: ["message_id", "thread_id", "reply_text"],
          additionalProperties: false,
        },
        execute: async (args: any) => {
          const data = await gmailApi({
            action: "reply",
            messageId: args.message_id,
            threadId: args.thread_id,
            body: args.reply_text,
          });
          if (data.error) return { error: data.error };
          await gmailApi({
            action: "archive",
            messageId: args.message_id,
          });
          deps.recordAction("reply");
          return { success: true, message: "Reply sent and email archived." };
        },
      }),

      tool({
        name: "archive_email",
        description:
          "Archive the current email (remove from inbox). Call this when the user says to archive.",
        parameters: {
          type: "object",
          properties: {
            message_id: {
              type: "string",
              description: "The ID of the email to archive",
            },
          },
          required: ["message_id"],
          additionalProperties: false,
        },
        execute: async (args: any) => {
          const data = await gmailApi({
            action: "archive",
            messageId: args.message_id,
          });
          if (data.error) return { error: data.error };
          deps.recordAction("archive");
          return { success: true, message: "Email archived." };
        },
      }),

      tool({
        name: "skip_email",
        description:
          "Skip the current email — marks it as read and moves on. Call this when the user says skip or next.",
        parameters: {
          type: "object",
          properties: {
            message_id: {
              type: "string",
              description: "The ID of the email to skip",
            },
          },
          required: ["message_id"],
          additionalProperties: false,
        },
        execute: async (args: any) => {
          const data = await gmailApi({
            action: "markRead",
            messageId: args.message_id,
          });
          if (data.error) return { error: data.error };
          deps.recordAction("skip");
          return { success: true, message: "Email marked as read." };
        },
      }),

      tool({
        name: "get_session_summary",
        description:
          "Get a summary of actions taken this session. Call this when the user says 'I'm done', 'that's all', 'wrap up', or wants to end the session.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
        execute: async () => {
          const summary = deps.getActionSummary();
          const emails = deps.emails();
          const idx = deps.emailIndex();
          const result = {
            replied: summary.replied,
            skipped: summary.skipped,
            archived: summary.archived,
            totalProcessed: summary.replied + summary.skipped + summary.archived,
            remaining: Math.max(0, emails.length - idx),
          };
          try {
            await fetch("/api/log", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ event: "session_summary", data: result }),
            });
          } catch {}
          return result;
        },
      }),
    ],

    handoffs: [],
  });
}
