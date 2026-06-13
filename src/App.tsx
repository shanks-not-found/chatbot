import React, { useState, useEffect, useRef } from 'react';
import { 
  Brain, Plus, Trash2, Edit2, Send, Search, 
  Settings, ToggleLeft, ToggleRight, Check, AlertCircle, 
  MessageSquare, Database, X, ChevronRight, Sparkles, CheckCircle2
} from 'lucide-react';
import { Thread, Message, MemoryEntry, SearchResultItem } from './types';

export default function App() {
  // Application State
  const [threads, setThreads] = useState<Thread[]>([]);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [threadMemories, setThreadMemories] = useState<MemoryEntry[]>([]);
  const [allMemories, setAllMemories] = useState<MemoryEntry[]>([]);
  
  // Settings & Toggles
  const [softDelete, setSoftDelete] = useState<boolean>(true);
  
  // Inputs
  const [inputMessage, setInputMessage] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>('');
  
  // Create manual memory
  const [manualMemText, setManualMemText] = useState<string>('');
  const [manualMemScore, setManualMemScore] = useState<number>(5);

  // UI state indicators
  const [loading, setLoading] = useState<boolean>(false);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [lastInjected, setLastInjected] = useState<MemoryEntry[]>([]);
  const [geminiConfigured, setGeminiConfigured] = useState<boolean>(true);
  
  // Ref for auto scroll
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch all threads on mount
  useEffect(() => {
    fetchThreads();
    fetchMemories();
    fetchSettings();
  }, []);

  // Fetch thread messages on switching
  useEffect(() => {
    if (currentThreadId) {
      fetchThreadDetails(currentThreadId);
    } else {
      setMessages([]);
      setThreadMemories([]);
      setLastInjected([]);
    }
  }, [currentThreadId]);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Network Fetch routines
  const fetchThreads = async () => {
    try {
      const res = await fetch('/api/threads');
      const data = await res.json();
      if (data.success) {
        setThreads(data.threads);
        // Automatically open the latest thread if none selected
        if (data.threads.length > 0 && !currentThreadId) {
          setCurrentThreadId(data.threads[0].id);
        }
      }
    } catch (e) {
      console.error("Failed fetching threads", e);
    }
  };

  const fetchMemories = async () => {
    try {
      const res = await fetch('/api/memory');
      const data = await res.json();
      if (data.success) {
        setAllMemories(data.memories);
      }
    } catch (e) {
      console.error("Failed fetching memories", e);
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings/soft-delete');
      const data = await res.json();
      if (data.success) {
        setSoftDelete(data.softDelete);
      }
    } catch (e) {
      console.error("Failed loading settings", e);
    }
  };

  const toggleSoftDeleteSetting = async () => {
    const nextVal = !softDelete;
    setSoftDelete(nextVal);
    try {
      await fetch('/api/settings/soft-delete', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ softDelete: nextVal })
      });
    } catch (e) {
      console.error("Failed saving settings toggle", e);
    }
  };

  const fetchThreadDetails = async (id: string) => {
    setSyncing(true);
    try {
      const res = await fetch(`/api/thread/${id}`);
      const data = await res.json();
      if (data.success) {
        setMessages(data.messages);
        setThreadMemories(data.memories);
      }
    } catch (e) {
      console.error("Error loaded thread detail", e);
    } finally {
      setSyncing(false);
    }
  };

  // Actions
  const handleCreateThread = async (initialTitle?: string) => {
    try {
      const res = await fetch('/api/thread/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: initialTitle })
      });
      const data = await res.json();
      if (data.success) {
        setThreads(prev => [data.thread, ...prev]);
        setCurrentThreadId(data.thread.id);
        setLastInjected([]);
      }
    } catch (e) {
      console.error("Create thread error", e);
    }
  };

  const handleRenameThread = async (id: string) => {
    if (!renameValue.trim()) return;
    try {
      const res = await fetch(`/api/thread/${id}/rename`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: renameValue })
      });
      const data = await res.json();
      if (data.success) {
        setThreads(prev => prev.map(t => t.id === id ? data.thread : t));
        setRenameId(null);
        setRenameValue('');
      }
    } catch (e) {
      console.error("Rename thread error", e);
    }
  };

  const handleDeleteThread = async (id: string) => {
    if (!confirm("Are you sure you want to delete this thread?")) return;
    try {
      const res = await fetch(`/api/thread/${id}?softDelete=${softDelete}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        setThreads(prev => prev.filter(t => t.id !== id));
        if (currentThreadId === id) {
          setCurrentThreadId(null);
        }
        fetchMemories(); // Refresh global list since memories may have been hard-deleted
      }
    } catch (e) {
      console.error("Delete thread error", e);
    }
  };

  // Chat message Dispatcher
  const handleSendMessage = async (e?: React.FormEvent, customMsg?: string) => {
    if (e) e.preventDefault();
    const msg = customMsg || inputMessage;
    if (!msg.trim() || !currentThreadId) return;

    // Build temporary user message state for immediate frontend rendering
    const tempUserMsg: Message = {
      id: 'temp-u-' + Date.now(),
      thread_id: currentThreadId,
      role: 'user',
      content: msg,
      created_at: new Date().toISOString()
    };

    setMessages(prev => [...prev, tempUserMsg]);
    setInputMessage('');
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thread_id: currentThreadId,
          message: msg
        })
      });
      const data = await res.json();
      if (data.success) {
        // Update loaded history with database entities
        fetchThreadDetails(currentThreadId);
        setLastInjected(data.injectedMemories || []);
        setGeminiConfigured(data.geminiConfigured);
        
        // Refresh structural memories list in the right panel
        setTimeout(() => {
          fetchMemories();
        }, 800); // Small timeout to give background dynamic extraction room to write!
      }
    } catch (error) {
      console.error("Failed sending message", error);
    } finally {
      setLoading(false);
    }
  };

  const handleManualAddMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualMemText.trim()) return;
    try {
      const res = await fetch('/api/memory/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memory_text: manualMemText,
          source_thread_id: currentThreadId || undefined,
          importance_score: manualMemScore
        })
      });
      const data = await res.json();
      if (data.success) {
        setManualMemText('');
        setManualMemScore(5);
        fetchMemories();
      }
    } catch (e) {
      console.error("Manual memory add failure", e);
    }
  };

  const handleDeleteMemory = async (id: string) => {
    try {
      const res = await fetch(`/api/memory/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setAllMemories(prev => prev.filter(m => m.id !== id));
      }
    } catch (e) {
      console.error("Failed removing memory", e);
    }
  };

  // Handles fast message templates click-tricks for rapid testing
  const triggerTemplateChat = async (threadTitle: string, queryText: string) => {
    // 1. Create a brand new thread named threadTitle
    try {
      const res = await fetch('/api/thread/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: threadTitle })
      });
      const data = await res.json();
      if (data.success) {
        setThreads(prev => [data.thread, ...prev]);
        setCurrentThreadId(data.thread.id);
        // Dispatch message in timeout to give thread_id switch time
        setTimeout(() => {
          handleSendMessage(undefined, queryText);
        }, 300);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Keyword filter on search memories locally or via API
  const handleLocalSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      if (data.success) {
        setSearchResults(data.results);
      }
    } catch (e) {
      console.error("Search failed", e);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 8) return 'text-[#8B0000] bg-[#8B0000]/5 border-[#8B0000]/20';
    if (score >= 5) return 'text-[#121212] bg-[#121212]/5 border-[#121212]/10';
    return 'text-[#121212]/60 bg-[#121212]/5 border-transparent';
  };

  return (
    <div id="root-app" className="flex flex-col h-screen w-full bg-[#FDFCFB] text-[#121212] font-serif overflow-hidden">
      
      {/* Top Editorial Navigation Bar */}
      <header className="h-16 border-b border-[#121212]/10 flex items-center justify-between px-8 flex-shrink-0 bg-[#FDFCFB]">
        <div className="flex items-center gap-4">
          <span className="text-xl font-extrabold tracking-tighter uppercase font-display">Omni.Memo</span>
          <span className="text-[9px] bg-[#121212] text-white px-2 py-0.5 rounded uppercase tracking-widest font-sans font-bold">
            v2.4.0
          </span>
        </div>
        
        <div className="flex items-center gap-6 font-sans text-[10px] font-bold uppercase tracking-widest text-[#121212]/60">
          <div className="flex items-center gap-2">
            <span className="opacity-60">Memory Core: SQLite Embedded</span>
          </div>
          <div className="flex items-center gap-2">
            <span>Model: Gemini Pro</span>
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-600 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
          </div>
        </div>
      </header>

      {/* Main Structural Body */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* LEFT SIDEBAR: NAVIGATION & THREADS */}
        <aside id="sidebar-container" className="w-72 border-r border-[#121212]/10 flex flex-col bg-[#F9F7F4] font-sans">
          
          {/* New Thread Action */}
          <div className="p-4">
            <button 
              id="btn-new-thread"
              onClick={() => handleCreateThread()}
              className="w-full py-3 bg-[#121212] hover:bg-[#333333] text-white text-[10px] font-bold uppercase tracking-[0.2em] transition-colors cursor-pointer text-center"
            >
              + New Thread
            </button>
          </div>

          {/* Search/Find inside threads */}
          <div className="px-4 pb-2">
            <p className="text-[9px] text-[#121212]/50 font-bold uppercase tracking-wider mb-1.5">Locate Thread Conversations</p>
            <form onSubmit={handleLocalSearch} className="relative flex items-center bg-white border border-[#121212]/15 px-2.5 py-1.5">
              <input 
                type="text" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="FIND IN THREAD MESSAGES..." 
                className="w-full bg-transparent text-[10px] outline-none text-[#121212] placeholder-[#121212]/40 tracking-wider uppercase"
              />
              {searchQuery && (
                <button 
                  type="button" 
                  onClick={() => {
                    setSearchQuery('');
                    setSearchResults([]);
                  }}
                  className="text-[10px] text-[#121212]/40 hover:text-[#121212] ml-1"
                >
                  ✕
                </button>
              )}
            </form>
          </div>

          {/* Active Conversations dynamic lists */}
          <div className="flex-1 overflow-y-auto px-4 py-2 space-y-4">
            <div>
              <p className="text-[10px] text-[#121212]/40 font-bold uppercase tracking-widest mb-2 flex justify-between items-center">
                <span>Active Conversations</span>
                <span className="text-[9px] font-mono opacity-60 bg-[#121212]/10 px-1.5 py-0.5 rounded">{threads.length}</span>
              </p>
              
              {threads.length === 0 ? (
                <div className="text-center py-6 text-[#121212]/40 text-xs italic">
                  No editorial sessions found. Create one.
                </div>
              ) : (
                <div className="space-y-1">
                  {threads.map((t) => {
                    const isActive = t.id === currentThreadId;
                    const isRenaming = renameId === t.id;

                    return (
                      <div 
                        key={t.id}
                        id={`thread-item-${t.id}`}
                        onClick={() => !isRenaming && setCurrentThreadId(t.id)}
                        className={`group p-3 border cursor-pointer transition-all relative ${
                          isActive 
                            ? 'bg-white border-[#121212]/15 shadow-sm' 
                            : 'border-transparent hover:bg-[#121212]/5'
                        }`}
                      >
                        <div className="flex items-start gap-2 min-w-0 pr-12">
                          <MessageSquare className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${isActive ? 'text-[#8B0000]' : 'text-[#121212]/40'}`} />
                          
                          {isRenaming ? (
                            <input 
                              type="text"
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleRenameThread(t.id);
                                if (e.key === 'Escape') setRenameId(null);
                              }}
                              autoFocus
                              onClick={(e) => e.stopPropagation()}
                              className="bg-white border border-[#121212]/20 px-1 py-0.5 text-[11px] w-full focus:outline-none focus:border-[#121212]"
                            />
                          ) : (
                            <div className="min-w-0">
                              <p className={`text-xs ${isActive ? 'font-bold italic text-[#121212]' : 'font-semibold text-[#121212]/75'}`}>
                                {t.title}
                              </p>
                              <p className="text-[9px] text-[#121212]/40 mt-1 uppercase tracking-wider font-mono">
                                Active Note
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Inline Actions */}
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity bg-[#F9F7F4] group-hover:bg-white px-1 py-0.5">
                          {isRenaming ? (
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRenameThread(t.id);
                              }}
                              className="p-1 text-emerald-700 hover:bg-[#121212]/5 rounded"
                            >
                              <Check className="w-3 h-3" />
                            </button>
                          ) : (
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                setRenameId(t.id);
                                setRenameValue(t.title);
                              }}
                              className="p-1 text-[#121212]/60 hover:text-[#121212]"
                              title="Rename Thread"
                            >
                              <Edit2 className="w-3 h-3" />
                            </button>
                          )}
                          
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteThread(t.id);
                            }}
                            className="p-1 text-[#121212]/60 hover:text-[#8B0000]"
                            title="Delete Thread"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Soft-Delete configuration and Lifecycle Control panel */}
          <div className="p-4 border-t border-[#121212]/10 bg-[#121212]/5 space-y-3 font-sans">
            <div className="space-y-1">
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-1 text-[#121212]">
                <Settings className="w-3.5 h-3.5 text-[#121212]" /> Lifecycle Controls
              </h3>
              <p className="text-[9px] text-[#121212]/50 uppercase tracking-widest leading-normal">
                Structured Cognitive Policies
              </p>
            </div>

            <div className="flex items-center justify-between text-[11px] py-1 border-t border-b border-[#121212]/5">
              <span className="font-semibold text-[#121212]/70 uppercase tracking-wider">Soft Delete Memory</span>
              <button 
                id="toggle-soft-delete"
                onClick={toggleSoftDeleteSetting}
                className="text-[#121212] hover:opacity-80 focus:outline-none transition-all"
                title="Toggle Soft Delete Rules"
              >
                {softDelete ? (
                  <ToggleRight className="w-7 h-7 text-[#8B0000]" />
                ) : (
                  <ToggleLeft className="w-7 h-7 text-[#121212]/40" />
                )}
              </button>
            </div>
            
            <p className="text-[9px] text-[#121212]/60 leading-relaxed italic font-serif">
              {softDelete 
                ? "✓ Extracted memo statements remain live after parent thread deletion." 
                : "⚠ Hard Purge: Clears child facts completely upon thread removal."}
            </p>
          </div>
        </aside>

        {/* CENTER MAIN INTERFACE: CHAT HISTORY LOGS */}
        <main id="chat-stage" className="flex-1 flex flex-col bg-white overflow-hidden shadow-inner font-serif">
          
          {/* Simulated Warning Header */}
          {!geminiConfigured && (
            <div className="bg-[#8B0000]/10 border-b border-[#8B0000]/20 p-3 px-8 flex items-center justify-between text-[11px] text-[#8B0000] font-sans font-bold uppercase tracking-wider">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Simulated Mode: Add a Google Gemini Key in Settings to enable real AI extraction!</span>
              </div>
            </div>
          )}

          {/* Active Title Banner */}
          {currentThreadId && (
            <div className="px-8 py-4 bg-white border-b border-[#121212]/10 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-2.5 h-2.5 bg-[#8B0000] rounded-full shadow-[0_0_8px_rgba(139,0,0,0.4)]"></div>
                <div>
                  <h2 className="text-base font-bold font-display italic tracking-tight text-[#121212]">
                    {threads.find(t => t.id === currentThreadId)?.title || "Active Conversation"}
                  </h2>
                  <span className="text-[9px] font-sans uppercase font-bold tracking-widest text-[#121212]/40">
                    Thread Log Index — {messages.length} Records Saved
                  </span>
                </div>
              </div>
              {syncing && (
                <span className="text-[10px] font-sans font-black uppercase tracking-widest text-[#8B0000] animate-pulse">
                  syncing context...
                </span>
              )}
            </div>
          )}

          {/* Active Recall / Accompanying Injected Facts Bar */}
          {currentThreadId && lastInjected.length > 0 && (
            <div className="bg-[#FDFCFB] border-b border-[#121212]/10 px-8 py-3 shrink-0 font-sans">
              <div className="flex items-start gap-3">
                <Sparkles className="w-4 h-4 text-[#8B0000] shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="text-[9px] font-extrabold text-[#8B0000] uppercase tracking-[0.2em]">
                    Universal Memory Accompanying Injection
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {lastInjected.map((item, id) => (
                      <span 
                        key={id} 
                        className="text-[10px] font-medium bg-white text-[#121212] px-3 py-1 border border-[#121212]/10 flex items-center gap-2 hover:border-[#8B0000]/40 transition-colors"
                      >
                        <span className="text-[#8B0000]">✦</span> {item.memory_text}
                        <span className="text-[8px] font-mono bg-[#121212]/5 text-[#121212]/60 px-1 font-bold">W:{item.importance_score}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Conversation Area */}
          <div className="flex-1 p-8 overflow-y-auto scroll-smooth space-y-12 bg-white">
            
            {!currentThreadId ? (
              /* Editorial Elegant Onboardings Layout */
              <div className="max-w-xl mx-auto py-12 space-y-10">
                <div className="text-center space-y-4">
                  <div className="w-12 h-12 border-2 border-[#121212] text-[#121212] rounded-none flex items-center justify-center mx-auto mb-4 bg-[#F9F7F4]">
                    <Brain className="w-6 h-6" />
                  </div>
                  <h3 className="text-3xl font-display font-bold tracking-tight text-[#121212]">
                    Universal Cross-Thread Recall
                  </h3>
                  <div className="w-12 h-[1px] bg-[#121212]/20 mx-auto"></div>
                  <p className="text-[#121212]/70 text-sm leading-relaxed max-w-md mx-auto italic">
                    "Experience a cognitive memoir companion. Healthcare cues, allergies, professions, and key preferences derived in any conversation are safely indexed into a persistent SQLite core, then retrieved fluidly across isolated threads."
                  </p>
                </div>

                {/* Scenario Interactive Triggers Checklist */}
                <div className="space-y-4">
                  <h4 className="text-[10px] font-sans font-black text-[#121212]/40 uppercase tracking-[0.22em] text-center">
                    Simulate Dynamic Recall Flow
                  </h4>
                  
                  <div className="grid grid-cols-1 gap-3">
                    {/* Scenario card 1 */}
                    <div 
                      onClick={() => triggerTemplateChat("Acupuncture History", "I was diagnosed with penicillin allergies back in 2024. My doctor wants me to try acupuncture next week.")}
                      className="border border-[#121212]/10 hover:border-[#121212] p-5 cursor-pointer bg-[#FDFCFB] transition-all space-y-2 group"
                    >
                      <div className="flex items-center justify-between font-sans text-xs">
                        <span className="font-extrabold text-[#8B0000] uppercase tracking-wider">Step 1: Save Context (Thread A)</span>
                        <ChevronRight className="w-4 h-4 text-[#121212]/40 group-hover:translate-x-1 transition-transform" />
                      </div>
                      <p className="text-sm font-serif italic text-[#121212]/85">
                        "I was diagnosed with penicillin allergies back in 2024. My doctor wants me to try acupuncture next week."
                      </p>
                      <p className="text-[9px] font-sans uppercase font-bold tracking-wider text-[#121212]/45">
                        ➔ Creates Thread A, extracts allergic medical warning memory automatically.
                      </p>
                    </div>

                    {/* Scenario card 2 */}
                    <div 
                      onClick={() => triggerTemplateChat("General Medical Memo", "Are there any health issues or medication allergies I should let my acupuncturist know about?")}
                      className="border border-[#121212]/10 hover:border-[#121212] p-5 cursor-pointer bg-[#FDFCFB] transition-all space-y-2 group"
                    >
                      <div className="flex items-center justify-between font-sans text-xs">
                        <span className="font-extrabold text-[#121212] uppercase tracking-wider">Step 2: Cross-Recall (Isolated Thread B)</span>
                        <ChevronRight className="w-4 h-4 text-[#121212]/40 group-hover:translate-x-1 transition-transform" />
                      </div>
                      <p className="text-sm font-serif italic text-[#121212]/85">
                        "Are there any health issues or medication allergies I should let my acupuncturist know about?"
                      </p>
                      <p className="text-[9px] font-sans uppercase font-bold tracking-wider text-[#121212]/45">
                        ➔ Bootstraps isolated Thread B. Retrieves penicillin allergy from Step 1 globally.
                      </p>
                    </div>
                  </div>
                </div>
                
                <div className="text-center pt-2">
                  <button 
                    onClick={() => handleCreateThread()}
                    className="editorial-btn"
                  >
                    Start Empty Session
                  </button>
                </div>
              </div>
            ) : messages.length === 0 ? (
              /* Empty Conversation Area */
              <div className="flex flex-col items-center justify-center h-full text-[#121212]/40 space-y-4 py-24 font-sans">
                <MessageSquare className="w-8 h-8 text-[#121212]/20" />
                <p className="text-[11px] font-bold uppercase tracking-wider text-[#121212]/50">This ledger log is empty. Dispatch messages below.</p>
                
                <div className="flex flex-wrap gap-2 justify-center max-w-md pt-4">
                  <button 
                    onClick={() => handleSendMessage(undefined, "I have a systemic reaction to peanut proteins.")} 
                    className="text-[10px] uppercase font-bold tracking-wider bg-white border border-[#121212]/10 hover:border-[#121212] px-3 py-1.5 transition-all text-[#121212]/80"
                  >
                    "Allergic to peanut proteins"
                  </button>
                  <button 
                    onClick={() => handleSendMessage(undefined, "I earn my living as a security analyst.")} 
                    className="text-[10px] uppercase font-bold tracking-wider bg-white border border-[#121212]/10 hover:border-[#121212] px-3 py-1.5 transition-all text-[#121212]/80"
                  >
                    "I earn living as an analyst"
                  </button>
                  <button 
                    onClick={() => handleSendMessage(undefined, "My relative humors include hypertension medicine.")} 
                    className="text-[10px] uppercase font-bold tracking-wider bg-white border border-[#121212]/10 hover:border-[#121212] px-3 py-1.5 transition-all text-[#121212]/80"
                  >
                    "I take hypertension medicine"
                  </button>
                </div>
              </div>
            ) : (
              /* Beautiful Editorial Messages Scroll Block */
              <div className="max-w-2xl mx-auto space-y-10 font-serif">
                {messages.map((m) => {
                  const isAssistant = m.role === 'assistant';
                  return (
                    <div 
                      key={m.id}
                      className={`space-y-2 group ${isAssistant ? 'text-left' : 'text-right'}`}
                    >
                      {/* Meta information tags */}
                      <div className={`flex items-baseline gap-4 font-sans text-[9px] uppercase font-bold tracking-[0.2em] text-[#121212]/30 group-hover:text-[#121212]/60 ${isAssistant ? '' : 'justify-end'}`}>
                        {isAssistant ? (
                          <>
                            <span className="text-[#8B0000] flex items-center gap-1">
                              Omni Agent — {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <div className="h-[1px] flex-1 bg-[#121212]/10"></div>
                          </>
                        ) : (
                          <span>
                            User — {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                      </div>

                      {/* Content statement */}
                      {isAssistant ? (
                        <div className="space-y-3 pl-0">
                          <p className="text-xl leading-snug tracking-tight text-[#121212] whitespace-pre-wrap">
                            {m.content.includes("Based on your") ? (
                              <>
                                Based on your <span className="underline decoration-[#8B0000] decoration-2 underline-offset-4">Universal Memory</span>:
                                <span className="block mt-2 font-serif text-lg text-[#121212]/90 font-light leading-relaxed">{m.content.replace(/^Based on your\s*/i, "")}</span>
                              </>
                            ) : (
                              m.content
                            )}
                          </p>
                        </div>
                      ) : (
                        <p className="font-sans text-lg leading-relaxed font-medium bg-[#121212]/5 inline-block p-4 rounded-tl-2xl rounded-bl-2xl rounded-tr-sm text-left max-w-full text-[#121212]">
                          {m.content}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            
            {loading && (
              <div className="max-w-2xl mx-auto py-2">
                <div className="flex items-center gap-4 text-[#121212]/40 font-sans text-xs">
                  <div className="flex space-x-1">
                    <div className="w-1.5 h-1.5 bg-[#8B0000] rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                    <div className="w-1.5 h-1.5 bg-[#8B0000] rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                    <div className="w-1.5 h-1.5 bg-[#8B0000] rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                  </div>
                  <span className="italic uppercase tracking-widest text-[9px] font-bold">Scanning relational SQLite memories...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Keyword Search Result overlay */}
          {searchResults.length > 0 && (
            <div className="mx-8 mb-4 bg-[#F9F7F4] border border-[#121212]/15 p-4 flex flex-col max-h-48 overflow-y-auto space-y-3 shrink-0 font-sans">
              <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-[#121212]/70">
                <span className="flex items-center gap-2">
                  <Search className="w-3.5 h-3.5 text-[#8B0000]" /> CONVERSATION SEARCH INDEX ({searchResults.length})
                </span>
                <button onClick={() => setSearchResults([])} className="text-[#121212]/60 hover:text-[#121212]">
                  ✕ CLOSE INDEX
                </button>
              </div>
              <div className="space-y-2">
                {searchResults.map((item, idx) => (
                  <div 
                    key={idx} 
                    onClick={() => {
                      setCurrentThreadId(item.thread.id);
                      setSearchResults([]);
                    }}
                    className="p-3 bg-white border border-[#121212]/10 hover:border-[#121212] transition-colors cursor-pointer text-xs"
                  >
                    <div className="flex justify-between font-bold text-[#121212]/80 text-[10px] uppercase mb-1">
                      <span>Thread Ledg: {item.thread.title}</span>
                      <span className="font-mono text-[#121212]/40">{new Date(item.message.created_at).toLocaleDateString()}</span>
                    </div>
                    <p className="font-serif text-[#121212]/70 italic truncate">
                      "{item.message.content}"
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Chat Composer bar */}
          <div className="p-6 border-t border-[#121212]/10 bg-white">
            <form 
              onSubmit={handleSendMessage}
              className="max-w-2xl mx-auto relative"
            >
              <div className="absolute -top-6 left-0 flex gap-2">
                 <span className="text-[9px] font-sans font-bold text-[#8B0000] bg-[#8B0000]/10 px-2.5 py-0.5 rounded-none uppercase tracking-wider">
                   Context: Global Universal Memory Listening
                 </span>
              </div>
              <input 
                type="text" 
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                disabled={!currentThreadId || loading}
                placeholder={currentThreadId ? "Type your query here..." : "Select or create an active notes ledger session."}
                className="w-full font-serif text-lg py-4 pl-6 pr-28 bg-[#F9F7F4] border-2 border-transparent focus:border-[#121212] outline-none transition-all disabled:opacity-50 text-[#121212] placeholder-[#121212]/40"
              />
              <button 
                id="btn-send-message"
                type="submit"
                disabled={!currentThreadId || !inputMessage.trim() || loading}
                className="absolute right-4 top-1/2 -translate-y-1/2 font-sans text-[10px] font-black uppercase tracking-tighter disabled:opacity-40 hover:opacity-80 transition-opacity cursor-pointer"
              >
                Send (Enter)
              </button>
            </form>
          </div>
        </main>



      </div>

    </div>
  );
}
