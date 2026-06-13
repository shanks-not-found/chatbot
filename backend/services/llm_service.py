import os
import json
from typing import List, Dict, Any

class LLMService:
    def __init__(self):
        self.provider = os.getenv("LLM_PROVIDER", "gemini").lower()
        self.gemini_key = os.getenv("GEMINI_API_KEY")
        self.openai_key = os.getenv("OPENAI_API_KEY")
        self.groq_key = os.getenv("GROQ_API_KEY")

    def generate_chat_response(self, system_prompt: str, messages: List[Dict[str, str]]) -> str:
        """
        Generate response from configured LLM provider.
        """
        # Let's support the different providers cleanly
        if self.provider == "gemini":
            return self._call_gemini(system_prompt, messages)
        elif self.provider == "openai":
            return self._call_openai(system_prompt, messages)
        elif self.provider == "groq":
            return self._call_groq(system_prompt, messages)
        else:
            raise ValueError(f"Unsupported LLM_PROVIDER: {self.provider}")

    def extract_memories(self, user_msg: str, assistant_reply: str) -> List[Dict[str, Any]]:
        """
        Extract meaningful facts from user conversation.
        """
        prompt = (
            "Analyze this conversation segment. Extract concise, specific facts about the user (e.g., medical conditions, allergic reactions, daily files, job, favorite things).\n"
            "DO NOT extract assistant behaviors, short-term states (like feeling sleepy today), greetings, or trivial questions.\n"
            "Format of Statement: 3rd person starting with 'User...'. Example: 'User is allergic to walnuts.'\n\n"
            f"User: \"{user_msg}\"\n"
            f"Assistant: \"{assistant_reply}\"\n\n"
            "Return ONLY a clean JSON list of objects. Each object must have fields 'memory_text' (string) and 'importance_score' (integer between 1 and 10).\n"
            "Example:\n"
            '[\n  {"memory_text": "User is learning FastAPI", "importance_score": 5}\n]\n'
            "If no meaningful facts exist, return exactly: []"
        )
        
        system_instruction = "You are a precise JSON extractor. Output valid JSON list with no markdown wrapper."

        try:
            if self.provider == "gemini":
                raw_text = self._call_gemini(system_instruction, [{"role": "user", "content": prompt}])
            elif self.provider == "openai":
                raw_text = self._call_openai(system_instruction, [{"role": "user", "content": prompt}], json_mode=True)
            elif self.provider == "groq":
                raw_text = self._call_groq(system_instruction, [{"role": "user", "content": prompt}], json_mode=True)
            else:
                return []

            # Cleanup code block wrappers if any
            clean_text = raw_text.strip()
            if clean_text.startswith("```json"):
                clean_text = clean_text[7:]
            if clean_text.startswith("```"):
                clean_text = clean_text[3:]
            if clean_text.endswith("```"):
                clean_text = clean_text[:-3]
            clean_text = clean_text.strip()

            if not clean_text:
                return []

            return json.loads(clean_text)
        except Exception as e:
            print(f"Error extracting memories through LLM: {e}")
            return []

    def _call_gemini(self, system_instruction: str, messages: List[Dict[str, str]]) -> str:
        """
        Invokes Gemini API via google-genai or standard REST API fallback to ensure zero setup failures.
        """
        if not self.gemini_key:
            return "[Error: GEMINI_API_KEY environment variable is missing on server]"

        try:
            # Prefer the modern google-genai package if available
            from google import genai
            from google.genai import types
            
            client = genai.Client(api_key=self.gemini_key)
            
            # Map messages
            contents = []
            for msg in messages:
                role = "user" if msg["role"] == "user" else "model"
                contents.append(types.Content(
                    role=role,
                    parts=[types.Part.from_text(text=msg["content"])]
                ))
                
            response = client.models.generate_content(
                model='gemini-3.5-flash',
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction
                )
            )
            return response.text or ""
        except ImportError:
            # Fallback to standard request calling API directly
            import requests
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key={self.gemini_key}"
            
            # Convert system instruction and messages to Google API format
            contents_payload = []
            for msg in messages:
                role = "user" if msg["role"] == "user" else "model"
                contents_payload.append({
                    "role": role,
                    "parts": [{"text": msg["content"]}]
                })
                
            payload = {
                "contents": contents_payload,
                "systemInstruction": {
                    "parts": [{"text": system_instruction}]
                }
            }
            
            res = requests.post(url, json=payload)
            if res.status_code == 200:
                data = res.json()
                try:
                    return data["candidates"][0]["content"]["parts"][0]["text"]
                except KeyError:
                    return f"Error parsing API Response. Keys in response: {list(data.keys())}"
            else:
                return f"[HTTP {res.status_code} Error from Google API: {res.text}]"

    def _call_openai(self, system_instruction: str, messages: List[Dict[str, str]], json_mode: bool = False) -> str:
        """
        Invokes OpenAI API using the official client library.
        """
        if not self.openai_key:
            return "[Error: OPENAI_API_KEY environment variable is missing on server]"

        try:
            from openai import OpenAI
            client = OpenAI(api_key=self.openai_key)
            
            formatted_msgs = [{"role": "system", "content": system_instruction}]
            for msg in messages:
                role = "user" if msg["role"] == "role" else msg["role"]
                formatted_msgs.append({"role": role, "content": msg["content"]})
                
            response_format = {"type": "json_object"} if json_mode else None
            
            chat_completion = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=formatted_msgs,
                response_format=response_format
            )
            return chat_completion.choices[0].message.content or ""
        except Exception as e:
            return f"[OpenAI Call Failed: {e}]"

    def _call_groq(self, system_instruction: str, messages: List[Dict[str, str]], json_mode: bool = False) -> str:
        """
        Invokes Groq API using the official client library.
        """
        if not self.groq_key:
            return "[Error: GROQ_API_KEY environment variable is missing on server]"

        try:
            from groq import Groq
            client = Groq(api_key=self.groq_key)
            
            formatted_msgs = [{"role": "system", "content": system_instruction}]
            for msg in messages:
                formatted_msgs.append({"role": msg["role"], "content": msg["content"]})
                
            response_format = {"type": "json_object"} if json_mode else None
            
            chat_completion = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=formatted_msgs,
                response_format=response_format
            )
            return chat_completion.choices[0].message.content or ""
        except Exception as e:
            return f"[Groq Call Failed: {e}]"
