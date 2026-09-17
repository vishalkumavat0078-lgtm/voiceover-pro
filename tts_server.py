import asyncio, os, uuid, time, hashlib
from pathlib import Path
from typing import Optional
import edge_tts
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="vishal11 pro TTS Engine", version="2.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

AUDIO_DIR = Path("audio_cache")
AUDIO_DIR.mkdir(exist_ok=True)

VOICES = {
  "adam": {"name":"Adam","desc":"Deep, authoritative narration voice","gender":"male","lang":"English","accent":"American","age":"middle aged","use":"narration","preview":"This is Adam speaking. Deep and authoritative, perfect for narration and documentaries.","edge":"en-US-GuyNeural","labels":{"accent":"american","description":"deep","age":"middle aged","gender":"male","use case":"narration"}},
  "rachel": {"name":"Rachel","desc":"Calm and professional female voice","gender":"female","lang":"English","accent":"American","age":"young","use":"audiobook","preview":"Hi, I am Rachel. Calm, professional, and perfect for audiobooks and storytelling.","edge":"en-US-JennyNeural","labels":{"accent":"american","description":"calm","age":"young","gender":"female","use case":"audiobook"}},
  "josh": {"name":"Josh","desc":"Young, energetic male voice","gender":"male","lang":"English","accent":"American","age":"young","use":"conversational","preview":"Hey there! I am Josh, your go-to voice for energetic and engaging content creation.","edge":"en-US-EricNeural","labels":{"accent":"american","description":"energetic","age":"young","gender":"male","use case":"conversational"}},
  "bella": {"name":"Bella","desc":"Friendly, warm female voice","gender":"female","lang":"English","accent":"American","age":"young","use":"social media","preview":"Hello! I am Bella. Warm, friendly, and perfect for social content and marketing.","edge":"en-US-AriaNeural","labels":{"accent":"american","description":"friendly","age":"young","gender":"female","use case":"social media"}},
  "antoni": {"name":"Antoni","desc":"Warm storytelling voice","gender":"male","lang":"English","accent":"American","age":"young","use":"audiobook","preview":"I am Antoni. Let me take you on a journey through the timeless art of storytelling.","edge":"en-US-AndrewNeural","labels":{"accent":"american","description":"warm","age":"young","gender":"male","use case":"audiobook"}},
  "domi": {"name":"Domi","desc":"Strong, confident female voice","gender":"female","lang":"English","accent":"American","age":"young","use":"narration","preview":"I am Domi. Strong, confident, and ready to deliver your message with maximum impact.","edge":"en-US-EmmaNeural","labels":{"accent":"american","description":"strong","age":"young","gender":"female","use case":"narration"}},
  "elli": {"name":"Elli","desc":"Light, emotional female voice","gender":"female","lang":"English","accent":"American","age":"young","use":"audiobook","preview":"Hi, I am Elli. Light, emotional and expressive, perfect for bringing stories to life.","edge":"en-US-MichelleNeural","labels":{"accent":"american","description":"emotional","age":"young","gender":"female","use case":"audiobook"}},
  "arnold": {"name":"Arnold","desc":"Crisp news broadcaster voice","gender":"male","lang":"English","accent":"American","age":"middle aged","use":"news","preview":"This is Arnold. Crisp, authoritative delivery for news and corporate communications.","edge":"en-US-BrianNeural","labels":{"accent":"american","description":"crisp","age":"middle aged","gender":"male","use case":"news"}},
  "sam": {"name":"Sam","desc":"Raspy, intense male voice","gender":"male","lang":"English","accent":"American","age":"young","use":"narration","preview":"Sam here. Raspy, intense, perfect for dramatic and compelling narrative content.","edge":"en-US-ChristopherNeural","labels":{"accent":"american","description":"raspy","age":"young","gender":"male","use case":"narration"}},
  "thomas": {"name":"Thomas","desc":"Calm professional British voice","gender":"male","lang":"English","accent":"British","age":"young","use":"conversational","preview":"Hello, I am Thomas. Calm British delivery, ideal for professional and corporate content.","edge":"en-GB-RyanNeural","labels":{"accent":"british","description":"calm","age":"young","gender":"male","use case":"conversational"}},
  "charlotte": {"name":"Charlotte","desc":"Elegant British female voice","gender":"female","lang":"English","accent":"British","age":"young","use":"audiobook","preview":"I am Charlotte. Elegant British tones for your premium audiobook and media content.","edge":"en-GB-SoniaNeural","labels":{"accent":"british","description":"elegant","age":"young","gender":"female","use case":"audiobook"}},
  "fin": {"name":"Fin","desc":"Warm Irish male voice","gender":"male","lang":"English","accent":"Irish","age":"old","use":"conversational","preview":"The name is Fin. Irish warmth and character in every single word I speak.","edge":"en-IE-ConnorNeural","labels":{"accent":"irish","description":"warm","age":"old","gender":"male","use case":"conversational"}},
  "swara": {"name":"Swara","desc":"Natural warm Hindi female voice","gender":"female","lang":"Hindi","accent":"Indian","age":"young","use":"audiobook","preview":"Namaste, main Swara hun. Meri awaaz mein garmahat aur prakritik bhaav hai.","edge":"hi-IN-SwaraNeural","labels":{"accent":"indian","description":"natural","age":"young","gender":"female","use case":"audiobook"}},
  "madhur": {"name":"Madhur","desc":"Deep authoritative Hindi male voice","gender":"male","lang":"Hindi","accent":"Indian","age":"middle aged","use":"narration","preview":"Namaste, main Madhur hun. Gahari aur prabhavshali awaaz mein aapki baat pahunchata hun.","edge":"hi-IN-MadhurNeural","labels":{"accent":"indian","description":"deep","age":"middle aged","gender":"male","use case":"narration"}},
  "priya": {"name":"Priya","desc":"Soft melodious Hindi female","gender":"female","lang":"Hindi","accent":"Indian","age":"young","use":"conversational","preview":"Hello! Main Priya hun. Madhur awaaz mein aapka swagat karte hain.","edge":"hi-IN-SwaraNeural","labels":{"accent":"indian","description":"soft","age":"young","gender":"female","use case":"conversational"}},
  "arjun": {"name":"Arjun","desc":"Bold confident Hindi male voice","gender":"male","lang":"Hindi","accent":"Indian","age":"young","use":"narration","preview":"Namaste! Main Arjun hun. Sahasee aur aatmavishwasi awaaz mein aapka swagat hai.","edge":"hi-IN-MadhurNeural","labels":{"accent":"indian","description":"bold","age":"young","gender":"male","use case":"narration"}},
}

class TTSRequest(BaseModel):
    text: str
    voice_id: Optional[str] = "rachel"
    stability: Optional[float] = 0.75
    similarity_boost: Optional[float] = 0.75
    style: Optional[float] = 0.0
    speed: Optional[float] = 1.0
    output_format: Optional[str] = "mp3_44100_128"

async def generate_audio(text: str, voice_id: str, speed: float = 1.0) -> Path:
    v = VOICES.get(voice_id, VOICES["rachel"])
    rate_pct = int((speed - 1.0) * 100)
    rate_str = f"+{rate_pct}%" if rate_pct >= 0 else f"{rate_pct}%"
    cache_key = hashlib.md5(f"{text[:200]}{voice_id}{speed}".encode()).hexdigest()
    cached = AUDIO_DIR / f"{cache_key}.mp3"
    if cached.exists() and cached.stat().st_size > 0:
        return cached
    out = AUDIO_DIR / f"{uuid.uuid4()}.mp3"
    communicate = edge_tts.Communicate(text, v["edge"], rate=rate_str)
    await communicate.save(str(out))
    if not out.exists() or out.stat().st_size == 0:
        raise HTTPException(status_code=500, detail="Audio generation failed")
    out.rename(cached)
    return cached

@app.get("/health")
async def health():
    return {"status": "ok", "engine": "edge-tts", "voices": len(VOICES)}

@app.get("/v1/voices")
async def get_voices():
    return {"voices": [{"voice_id": vid, "name": v["name"], "description": v["desc"], "preview_url": f"/v1/voices/{vid}/preview", "category": "premade", "language": v["lang"], "gender": v["gender"], "accent": v["accent"], "age": v["age"], "use_case": v["use"], "labels": v["labels"], "high_quality_base_model_ids": ["eleven_multilingual_v2","eleven_flash_v2_5","eleven_v3"], "settings": {"stability": 0.75,"similarity_boost": 0.75,"style": 0.0,"use_speaker_boost": True}} for vid, v in VOICES.items()]}

@app.get("/v1/voices/{voice_id}/preview")
async def preview_voice(voice_id: str):
    v = VOICES.get(voice_id)
    if not v:
        raise HTTPException(status_code=404, detail="Voice not found")
    audio_path = await generate_audio(v["preview"], voice_id, 1.0)
    return FileResponse(audio_path, media_type="audio/mpeg")

@app.post("/v1/text-to-speech/{voice_id}")
async def tts(voice_id: str, request: TTSRequest):
    if not request.text or len(request.text.strip()) == 0:
        raise HTTPException(status_code=400, detail="Text is required")
    vid = voice_id if voice_id in VOICES else (request.voice_id if request.voice_id in VOICES else "rachel")
    audio_path = await generate_audio(request.text, vid, request.speed or 1.0)
    return FileResponse(audio_path, media_type="audio/mpeg", headers={"Content-Disposition": f"attachment; filename=audio_{int(time.time())}.mp3"})

@app.post("/v1/text-to-speech/{voice_id}/stream")
async def tts_stream(voice_id: str, request: TTSRequest):
    return await tts(voice_id, request)

@app.get("/v1/user/subscription")
async def subscription():
    return {"tier":"scale","status":"active","character_count":0,"character_limit":10000000,"remaining_characters":10000000,"can_use_instant_voice_cloning":True,"can_use_professional_voice_cloning":True,"voice_limit":500,"professional_voice_limit":500,"can_extend_character_limit":True,"allowed_to_extend_character_limit":True,"next_character_count_reset_unix":int(time.time())+2592000}

@app.get("/v1/user")
async def user():
    return {"xi_api_key":"unlimited","subscription":{"tier":"scale","status":"active","character_count":0,"character_limit":10000000,"remaining_characters":10000000,"voice_limit":500,"can_use_instant_voice_cloning":True,"can_use_professional_voice_cloning":True},"first_name":"Studio","last_name":"Pro","username":"vishal11pro","email":"studio@vishal11.pro","is_onboarded":True}

@app.get("/v1/models")
async def models():
    return {"models":[{"model_id":"eleven_v3","name":"Eleven v3","can_be_finetuned":True,"can_do_text_to_speech":True,"description":"Latest, most powerful model"},{"model_id":"eleven_multilingual_v2","name":"Eleven Multilingual v2","can_be_finetuned":True,"can_do_text_to_speech":True,"description":"Best multilingual quality"},{"model_id":"eleven_flash_v2_5","name":"Eleven Flash v2.5","can_be_finetuned":False,"can_do_text_to_speech":True,"description":"Fast and efficient"}]}

@app.get("/v1/history")
async def history():
    return {"history":[],"last_history_item_id":None,"has_more":False}

if __name__ == "__main__":
    import uvicorn
    print("\n" + "="*55)
    print("  vishal11 pro AI Voice Studio Engine v2.0")
    print("="*55)
    print(f"  Server: http://localhost:8000")
    print(f"  Voices: {len(VOICES)} voices loaded")
    print("  Status: Unlimited generation active")
    print("="*55 + "\n")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="warning")
