import fs from 'fs';
import path from 'path';
import { Thread, Message, MemoryEntry } from './src/types';

const DB_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DB_DIR, 'db.json');

interface DatabaseSchema {
  threads: Thread[];
  messages: Message[];
  memories: MemoryEntry[];
  settings: {
    softDelete: boolean;
  };
}

const defaultSchema: DatabaseSchema = {
  threads: [],
  messages: [],
  memories: [
    // Pre-seed some interesting memories for demonstration
    {
      id: "seed-1",
      memory_text: "User is allergic to peanuts.",
      source_thread_id: "thread-seed",
      source_thread_title: "Dietary Preferences",
      created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
      importance_score: 9
    },
    {
      id: "seed-2",
      memory_text: "User works as a software engineer.",
      source_thread_id: "thread-seed",
      source_thread_title: "Professional Background",
      created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
      importance_score: 6
    },
    {
      id: "seed-3",
      memory_text: "User works on web development using React and Express.",
      source_thread_id: "thread-seed-react",
      source_thread_title: "Work Projects",
      created_at: new Date(Date.now() - 3600000).toISOString(),
      importance_score: 5
    }
  ],
  settings: {
    softDelete: true
  }
};

function ensureDb() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultSchema, null, 2), 'utf-8');
  }
}

function readDb(): DatabaseSchema {
  ensureDb();
  try {
    const data = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error("Error reading database file, resetting to default.", error);
    return defaultSchema;
  }
}

function writeDb(db: DatabaseSchema) {
  ensureDb();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
}

export const dbService = {
  getThreads(): Thread[] {
    const db = readDb();
    return db.threads.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  },

  getThread(id: string): Thread | undefined {
    const db = readDb();
    return db.threads.find(t => t.id === id);
  },

  createThread(title?: string): Thread {
    const db = readDb();
    const thread: Thread = {
      id: 'thread-' + Math.random().toString(36).substring(2, 11),
      title: title || `Chat Thread ${db.threads.length + 1}`,
      created_at: new Date().toISOString()
    };
    db.threads.push(thread);
    writeDb(db);
    return thread;
  },

  renameThread(id: string, title: string): Thread | undefined {
    const db = readDb();
    const thread = db.threads.find(t => t.id === id);
    if (thread) {
      thread.title = title;
      writeDb(db);
    }
    return thread;
  },

  deleteThread(id: string, isSoftDelete?: boolean): { deletedMessages: number; deletedMemories: number } {
    const db = readDb();
    const useSoftDelete = isSoftDelete !== undefined ? isSoftDelete : db.settings.softDelete;

    // Filter threads
    db.threads = db.threads.filter(t => t.id !== id);

    // Messages
    const originalMsgCount = db.messages.length;
    db.messages = db.messages.filter(m => m.thread_id !== id);
    const deletedMessages = originalMsgCount - db.messages.length;

    // Memories
    const originalMemCount = db.memories.length;
    let deletedMemories = 0;
    if (!useSoftDelete) {
      db.memories = db.memories.filter(mem => mem.source_thread_id !== id);
      deletedMemories = originalMemCount - db.memories.length;
    }

    writeDb(db);
    return { deletedMessages, deletedMemories };
  },

  getMessages(threadId: string): Message[] {
    const db = readDb();
    return db.messages
      .filter(m => m.thread_id === threadId)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  },

  addMessage(threadId: string, role: 'user' | 'assistant', content: string): Message {
    const db = readDb();
    const message: Message = {
      id: 'msg-' + Math.random().toString(36).substring(2, 11),
      thread_id: threadId,
      role,
      content,
      created_at: new Date().toISOString()
    };
    db.messages.push(message);
    writeDb(db);
    return message;
  },

  getMemories(): MemoryEntry[] {
    const db = readDb();
    return db.memories.sort((a, b) => b.importance_score - a.importance_score);
  },

  addMemory(memoryText: string, sourceThreadId: string, importanceScore: number): MemoryEntry {
    const db = readDb();
    
    // De-duplicate memory text to prevent redundant entries from spamming the system
    const existing = db.memories.find(m => 
      m.memory_text.toLowerCase().trim() === memoryText.toLowerCase().trim()
    );
    if (existing) {
      existing.importance_score = Math.max(existing.importance_score, importanceScore);
      existing.created_at = new Date().toISOString();
      writeDb(db);
      return existing;
    }

    const thread = db.threads.find(t => t.id === sourceThreadId);
    
    const memory: MemoryEntry = {
      id: 'mem-' + Math.random().toString(36).substring(2, 11),
      memory_text: memoryText,
      source_thread_id: sourceThreadId,
      source_thread_title: thread ? thread.title : 'External Source',
      created_at: new Date().toISOString(),
      importance_score: importanceScore
    };
    db.memories.push(memory);
    writeDb(db);
    return memory;
  },

  deleteMemory(id: string): boolean {
    const db = readDb();
    const originalCount = db.memories.length;
    db.memories = db.memories.filter(m => m.id !== id);
    writeDb(db);
    return originalCount !== db.memories.length;
  },

  getSoftDeleteSetting(): boolean {
    const db = readDb();
    return db.settings.softDelete;
  },

  setSoftDeleteSetting(soft: boolean): void {
    const db = readDb();
    db.settings.softDelete = soft;
    writeDb(db);
  },

  searchDatabase(query: string): { message: Message; thread: Thread }[] {
    const db = readDb();
    const lowercaseQuery = query.toLowerCase();

    // Find any matching messages
    const matchedMessages = db.messages.filter(m => 
      m.content.toLowerCase().includes(lowercaseQuery)
    );

    const results: { message: Message; thread: Thread }[] = [];
    matchedMessages.forEach(msg => {
      const thread = db.threads.find(t => t.id === msg.thread_id);
      if (thread) {
        results.push({
          message: msg,
          thread
        });
      }
    });

    return results;
  }
};
