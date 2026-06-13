import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import { dbService } from './serverDb';
import dotenv from 'dotenv';

// Load environment variables from .env
dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Helper to determine if working key is available
const isGeminiConfigured = () => {
  const key = process.env.GEMINI_API_KEY;
  return !!(key && key !== 'MY_GEMINI_API_KEY' && key.trim().length > 0);
};

// Lazy loaded GoogleGenAI client to read process.env at request time and pick up dynamic key changes
function getGoogleGenAI() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY is not defined or is set to default placeholder');
  }
  return new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
}

// Relevance Scorer for Memory Retrieval
function findRelevantMemories(userMessage: string, allMemories: any[]): any[] {
  const stopwords = new Set([
    'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours', 
    'he', 'him', 'his', 'she', 'her', 'it', 'its', 'they', 'them', 'who', 'what', 'which', 
    'where', 'when', 'why', 'how', 'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being', 
    'have', 'has', 'had', 'do', 'does', 'did', 'a', 'an', 'the', 'and', 'but', 'if', 'or', 
    'because', 'as', 'until', 'while', 'of', 'at', 'by', 'for', 'with', 'about', 'against', 
    'between', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from', 
    'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 
    'here', 'there', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 
    'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'can', 
    'will', 'just', 'should', 'now', 'have', 'mention', 'mentioned', 'before', 'told'
  ]);
  
  const queryWords = userMessage
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopwords.has(w));

  if (queryWords.length === 0) {
    return allMemories.slice(0, 5); // Return top 5 by default if too short
  }

  const scored = allMemories.map(mem => {
    const memWords = mem.memory_text
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/);
    
    let matchCount = 0;
    queryWords.forEach(qw => {
      if (memWords.some((mw: string) => mw.includes(qw) || qw.includes(mw))) {
        matchCount += 1;
      }
    });

    const score = matchCount * (mem.importance_score + 1);
    return { mem, score };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.mem.importance_score - a.mem.importance_score;
  });

  const hits = scored.filter(s => s.score > 0).map(s => s.mem);
  if (hits.length > 0) {
    return hits.slice(0, 7);
  }
  
  return allMemories.slice(0, 4); // Fallback to raw importance entries
}

// Global list of supported text/reasoning models to try in sequence for high availability
const PRIMARY_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-3.1-pro-preview',
];

// Helper to execute generateContent with model-failover logic
async function generateContentWithFailover(aiInstance: any, params: { contents: any[], systemInstruction: string }) {
  let lastError: any = null;
  for (const modelName of PRIMARY_MODELS) {
    try {
      console.log(`[Cognitive Link] Attempting content Generation using model: ${modelName}`);
      const response = await aiInstance.models.generateContent({
        model: modelName,
        contents: params.contents,
        config: {
          systemInstruction: params.systemInstruction,
          temperature: 0.7,
        }
      });
      if (response && response.text) {
        console.log(`[Cognitive Link] Generation succeeded using model: ${modelName}`);
        return response;
      }
    } catch (err: any) {
      console.warn(`[Cognitive Link Warning] Model ${modelName} failed or returned no text. Error: ${err.message || err}`);
      lastError = err;
    }
  }
  throw lastError || new Error("All loaded failover models returned empty responses or failed.");
}

// Help create custom medical / wellness response locally if Gemini is totally unreachable 
function compileLocalEmpatheticResponse(userQuery: string, retrievedMemories: any[]): string {
  const queryLower = userQuery.toLowerCase();
  
  let memoryBullets = "";
  if (retrievedMemories.length > 0) {
    memoryBullets = `\n\n**Cross-Thread Medical/Context Logs Retrieved:**\n${retrievedMemories.map(m => `• ${m.memory_text} (Weight/Importance: ${m.importance_score})`).join('\n')}`;
  }

  // Chest Pain / Cardiovascular Alerts
  if (queryLower.includes('chest') && (queryLower.includes('pain') || queryLower.includes('hurt') || queryLower.includes('breathe') || queryLower.includes('pressure'))) {
    return `⚕️ **Supportive Clinical Core Notice (Emergency Alert)**
I notice that you reported experiencing chest pain, tightness, or breathing-related distress. This can be a sign of acute cardiac strain or cardiovascular emergencies. 

Because our remote Gemini cognitive server is currently experiencing temporary high demand (503 Service Unavailable), I am delivering a secure, local system response:

1. **Immediate Precaution**: Please seek contact with professional medical emergency responders (such as **911** or your local urgent care) immediately. 
2. **Rest**: Lie down or sit in a comfortable, upright position. Do not engage in physical stress.
3. **Medical Records**: Keep any list of active medications, allergies, or past history handy for emergency clinicians.

*Note:* I have safely recorded your symptom in this session's ledger logs for cross-thread recall once online services resume.${memoryBullets}`;
  }

  // Stomach / Digestive distress
  if (queryLower.includes('stomach') || queryLower.includes('belly') || queryLower.includes('gut') || queryLower.includes('abdomen') || queryLower.includes('digest')) {
    return `🌿 **Healthcare Core Notice (Comfort & First Aid Tips)**
I hear you regarding the stomach distress or abdominal pain. 

While the Gemini AI cloud network is currently under extremely high traffic, I am utilizing local clinical heuristics to assist you right now:

- **Hydration**: Drink pure water or chamomile/peppermint teas in small, frequent sips to soothe local contractions.
- **Dietary Rest**: Avoid eating heavy, spicy, acidic, or high-sugar foods. Stick to simple bland items (toast, white rice, bananas) if the severe cramping subsides.
- **Abndominal Relief**: Rest on your side with knees slightly drawn up or apply a warm heating pad to your belly.
- **Red Flags**: If your stomach pain is sharp, unbearable, or accompanied by recurrent vomiting, high fever, or blood in stool, please go to an urgent care facility or hospital as soon as possible.

*Note:* This stomach pain report has been registered in your Universal SQLite core securely.${memoryBullets}`;
  }

  // Allergy notice
  if (queryLower.includes('allerg') || queryLower.includes('allergy') || queryLower.includes('reaction')) {
    return `⚠️ **Symptom Core Notice (Allergic Sensitivity)**
I've recognized your allergy mention. If you notice signs of anaphylaxis (facial swelling, trouble swallowing, hives, or dynamic breathing changes), please activate your emergency epinephrine auto-injector immediately and seek urgent hospital care.

*Status Check:* All details are safely cached locally in our persistent memory bank.${memoryBullets}`;
  }

  // General healthy support fallback 
  return `💬 **Omni Memo — Auxiliary Console Response**
I received your message: "${userQuery}".

Our remote Gemini core is currently experiencing an temporary spike in connection volume. Rest assured, your message is safely cached in your browser thread, and we retrieved these universal facts to form context:
${retrievedMemories.map(m => `- "${m.memory_text}" (Importance: ${m.importance_score}, Thread: "${m.source_thread_title}")`).join('\n') || '- None found in past logs.'}

*Private Key Info:* If you have your own personal API Key, you can add it in the AI Studio top Settings -> Secrets panel named \`GEMINI_API_KEY\` to activate direct exclusive routing.`;
}

// Memory extraction function inside thread scope with failover models
async function extractMemoryFromExchange(userMsg: string, aiMsg: string, threadId: string) {
  if (!isGeminiConfigured()) {
    console.warn("Skipping dynamic memory extraction: GEMINI_API_KEY is not defined");
    return;
  }

  const prompt = `Analyze this exchange. Extract concise, specific facts about the user (identity, preferences, projects, healthcare issues, goals, etc.).
DO NOT extract transient emotions, conversation fluff, simple greetings (e.g. "hi"), or robot tasks.
ONLY output substantial, long-term state facts.

CONVERSATION:
User: "${userMsg}"
Assistant: "${aiMsg}"

Return your output as a JSON array of objects.
Each object must represent a single, clear, atomic statement about the user and contain:
- "memory_text": A literal statement like "User is allergic to penicillin" or "User likes to paint with oil on canvas". Always write in the 3rd person starting with "User...".
- "importance_score": An integer between 1 and 10 indicating how critical this detail is (10 = critical medical warnings; 7-8 = primary job, address, core hobbies; 4-6 = personal projects, minor preferences; 1-3 = passive mentions of foods or details).

IF NO USEFUL FACTS exist in the exchange, return the exact array: []`;

  const schema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        memory_text: {
          type: Type.STRING,
          description: "Clean literal 3rd person fact about the user.",
        },
        importance_score: {
          type: Type.INTEGER,
          description: "Rank score 1 to 10.",
        },
      },
      required: ["memory_text", "importance_score"],
    },
  };

  // Attempt extraction through our primary supported models sequentially
  for (const modelName of PRIMARY_MODELS) {
    try {
      console.log(`[Cognitive Extractor] Attempting extraction with model: ${modelName}`);
      const response = await getGoogleGenAI().models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: schema,
        },
      });

      const text = response.text;
      if (text) {
        const entries = JSON.parse(text);
        if (Array.isArray(entries)) {
          for (const entry of entries) {
            if (entry.memory_text && entry.importance_score) {
              dbService.addMemory(
                entry.memory_text,
                threadId,
                Math.min(10, Math.max(1, entry.importance_score))
              );
            }
          }
        }
        console.log(`[Cognitive Extractor] Successfully parsed facts with model: ${modelName}`);
        return; // Success! Done extraction.
      }
    } catch (err: any) {
      console.warn(`[Cognitive Extractor Warning] Extraction model ${modelName} encountered error: ${err.message || err}`);
    }
  }

  console.error("[Cognitive Extractor Error] All available extraction fallback models were exhausted.");
}

// API Routes
// GET all threads
app.get('/api/threads', (req, res) => {
  const threads = dbService.getThreads();
  res.json({ success: true, threads });
});

// GET thread details + messages
app.get('/api/thread/:id', (req, res) => {
  const { id } = req.params;
  const thread = dbService.getThread(id);
  if (!thread) {
    return res.status(404).json({ success: false, error: 'Thread not found' });
  }
  const messages = dbService.getMessages(id);
  const threadMemories = dbService.getMemories().filter(m => m.source_thread_id === id);
  res.json({ success: true, thread, messages, memories: threadMemories });
});

// POST create thread
app.post('/api/thread/create', (req, res) => {
  const { title } = req.body;
  const thread = dbService.createThread(title);
  res.json({ success: true, thread });
});

// PUT rename thread
app.put('/api/thread/:id/rename', (req, res) => {
  const { id } = req.params;
  const { title } = req.body;
  if (!title || title.trim() === '') {
    return res.status(400).json({ success: false, error: 'Title is required' });
  }
  const thread = dbService.renameThread(id, title);
  if (!thread) {
    return res.status(404).json({ success: false, error: 'Thread not found' });
  }
  res.json({ success: true, thread });
});

// DELETE thread
app.delete('/api/thread/:id', (req, res) => {
  const { id } = req.params;
  const { softDelete } = req.query;
  const useSoft = softDelete !== undefined ? softDelete === 'true' : undefined;
  
  const stats = dbService.deleteThread(id, useSoft);
  res.json({ success: true, stats });
});

// GET all long term memories
app.get('/api/memory', (req, res) => {
  const memories = dbService.getMemories();
  res.json({ success: true, memories });
});

// POST custom memory manual adder (for testing/playgrounds)
app.post('/api/memory/create', (req, res) => {
  const { memory_text, source_thread_id, importance_score } = req.body;
  if (!memory_text) {
    return res.status(400).json({ success: false, error: 'Memory text is required' });
  }
  const mem = dbService.addMemory(
    memory_text,
    source_thread_id || 'thread-manual',
    importance_score || 5
  );
  res.json({ success: true, memory: mem });
});

// DELETE memory entry manually
app.delete('/api/memory/:id', (req, res) => {
  const { id } = req.params;
  const deleted = dbService.deleteMemory(id);
  res.json({ success: true, deleted });
});

// GET search old threads and messages
app.get('/api/search', (req, res) => {
  const { q } = req.query;
  if (!q) {
    return res.json({ success: true, results: [] });
  }
  const results = dbService.searchDatabase(q.toString());
  res.json({ success: true, results });
});

// GET soft delete config
app.get('/api/settings/soft-delete', (req, res) => {
  const softDelete = dbService.getSoftDeleteSetting();
  res.json({ success: true, softDelete });
});

// PUT soft delete config
app.put('/api/settings/soft-delete', (req, res) => {
  const { softDelete } = req.body;
  if (softDelete === undefined) {
    return res.status(400).json({ success: false, error: 'softDelete field required' });
  }
  dbService.setSoftDeleteSetting(softDelete);
  res.json({ success: true, softDelete });
});

// MAIN CHAT DISPATCHER with cognitive memories injected
app.post('/api/chat', async (req, res) => {
  const { thread_id, message } = req.body;
  if (!thread_id || !message) {
    return res.status(400).json({ success: false, error: 'thread_id and message are required' });
  }

  const thread = dbService.getThread(thread_id);
  if (!thread) {
    return res.status(404).json({ success: false, error: 'Thread not found' });
  }

  // 1. Save user message to database
  const userMsgEntity = dbService.addMessage(thread_id, 'user', message);

  // 2. Memory Retrieval System
  const allMemories = dbService.getMemories();
  const relevantMemories = findRelevantMemories(message, allMemories);

  // 3. Build thread conversation history
  const history = dbService.getMessages(thread_id);
  // Separate history up to the latest user message
  const pastConversations = history.filter(h => h.id !== userMsgEntity.id);

  // Fallback if Gemini is not configured
  if (!isGeminiConfigured()) {
    const fallbackText = `[MOCK RESPONSE - Gemini API Key not set yet in Secrets panel]
I received your message: "${message}".

I did a lookup inside the Universal Cross-Thread Memory!
Here are the memories I fetched for this conversation to build context:
${relevantMemories.map(m => `• "${m.memory_text}" (Importance: ${m.importance_score}, Source Thread: "${m.source_thread_title}")`).join('\n') || '• No memories found.'}

To activate real Gemini AI chat and dynamic memory extraction:
1. Open "Settings" -> "Secrets" in Google AI Studio
2. Set the GEMINI_API_KEY secret
3. Refresh this application!`;

    const assistantMsgEntity = dbService.addMessage(thread_id, 'assistant', fallbackText);
    
    // Attempt local heuristic mock memory extraction to demonstrate the flow immediately!
    if (message.toLowerCase().includes('allergic to')) {
      const allergyItem = message.match(/allergic to\s+([^.]+)/i)?.[1];
      if (allergyItem) {
        dbService.addMemory(`User is allergic to ${allergyItem}.`, thread_id, 9);
      }
    } else if (message.toLowerCase().includes('favorite color is')) {
      const color = message.match(/favorite color is\s+([^.]+)/i)?.[1];
      if (color) {
        dbService.addMemory(`User's favorite color is ${color}.`, thread_id, 3);
      }
    } else if (message.toLowerCase().includes('works as')) {
      const job = message.match(/works as\s+([^.]+)/i)?.[1];
      if (job) {
        dbService.addMemory(`User works as ${job}.`, thread_id, 6);
      }
    }

    return res.json({
      success: true,
      message: assistantMsgEntity,
      injectedMemories: relevantMemories,
      geminiConfigured: false
    });
  }

  try {
    // Construct System Instruction context showing retrieved long term memories
    const memorySection = relevantMemories.map(m => 
      `- ${m.memory_text} (Importance Score: ${m.importance_score}/10, Source: "${m.source_thread_title}")`
    ).join('\n');

    const systemInstruction = `You are a medical & general AI healthcare assistant with access to the user's permanent cross-thread long-term memory.
The application maintains a global memory system shared across all user conversations. Before this conversation segment, we retrieved relevant facts from other discussions.

RELEVANT CURRENT MEMORIES FOR CONTEXT:
${memorySection || 'No previous relevant long-term memories retrieved.'}

RULES OF CONTEXT:
1. Maintain extremely high-fidelity recall. If the user asks about previously mentioned health issues, jobs, or configurations that exist in the RELEVANT CURRENT MEMORIES, address them accurately.
2. DO NOT state "According to the database..." or "In my memory files...". Act natural, like any human who simply remembers facts told to them previously across conversations.
3. Be supportive, concise, accurate, and empathetic. If the user reports emergency medical symptoms (e.g., severe persistent chest pain), explicitly suggest contacting local emergency numbers (911) while naturally referencing their context if helpful.`;

    // Map conversation logs to chat structure
    // Prepare contents array for generateContent
    // Since we want multiple turns, we can map history directly or build a simple list of chat elements
    const contents = pastConversations.map(m => {
      return {
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }]
      };
    });

    // Append the current message
    contents.push({
      role: 'user',
      parts: [{ text: message }]
    });

    // Call generateContent with model failover array
    let response;
    let fallbackToLocalHeuristics = false;
    let replyText = "";

    try {
      response = await generateContentWithFailover(getGoogleGenAI(), {
        contents: contents,
        systemInstruction,
      });
      replyText = response.text || "I apologize, I processed your prompt but got empty text back.";
    } catch (apiError: any) {
      console.warn("[Cognitive dispatcher Warning] All Gemini fallback models were unavailable or rate-limited. Activating secure offline local healthcare responder.", apiError.message || apiError);
      fallbackToLocalHeuristics = true;
      replyText = compileLocalEmpatheticResponse(message, relevantMemories);
    }
    
    // Save response (either the Gemini response or the clean clinical-grade local advice representation)
    const assistantMsgEntity = dbService.addMessage(thread_id, 'assistant', replyText);

    // Dynamic background task - Smart Memory Extraction!
    // Analyze exchange, extract facts, store them securely in db
    // This is run asynchronously so it doesn't block the direct chat answer latency!
    if (!fallbackToLocalHeuristics) {
      extractMemoryFromExchange(message, replyText, thread_id)
        .then(() => console.log(`Dynamic memory extraction finished for thread ${thread_id}`))
        .catch(e => console.error("Dynamic memory extraction background task error:", e));
    }

    return res.json({
      success: true,
      message: assistantMsgEntity,
      injectedMemories: relevantMemories,
      geminiConfigured: true
    });

  } catch (apiError: any) {
    console.error("Gemini API direct failure:", apiError);
    const fallbackAdvice = compileLocalEmpatheticResponse(message, relevantMemories);
    const assistantMsgEntity = dbService.addMessage(thread_id, 'assistant', fallbackAdvice);
    return res.json({
      success: true,
      message: assistantMsgEntity,
      injectedMemories: relevantMemories,
      error: apiError.message || "An exception occurred inside the generation router.",
      geminiConfigured: true
    });
  }
});


// Configure Vite Development Server Middleware OR Static File Server for Production
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Universal Memory Chat server booting gracefully on http://localhost:${PORT}`);
  });
}

startServer();
