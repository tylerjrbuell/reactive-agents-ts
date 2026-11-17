/** Words that belong to messaging channels; a webhook is an inbound HTTP trigger and its copy never uses them (test helper). */
export const MESSAGING_WORDS = /\b(senders?|owners?|chats?|bot|repl(?:y|ies)|messages?|conversations?|direct|groups?|turns?|telegram|signal|accounts?|answers?|remembers?|dms?)\b/i;
