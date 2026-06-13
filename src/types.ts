export interface Thread {
  id: string;
  title: string;
  created_at: string;
}

export interface Message {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface MemoryEntry {
  id: string;
  memory_text: string;
  source_thread_id: string;
  source_thread_title?: string;
  created_at: string;
  importance_score: number;
}

export interface SearchResultItem {
  message: Message;
  thread: Thread;
}

export interface AppState {
  threads: Thread[];
  memories: MemoryEntry[];
  currentThreadId: string | null;
  messages: Message[];
  loadingChat: boolean;
  searchQuery: string;
  searchResults: SearchResultItem[];
  softDelete: boolean;
}
