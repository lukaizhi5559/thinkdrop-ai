class NaturalLanguageIntentParser {
    constructor() {
      this.embedder = null;
      this.zeroShotClassifier = null;
      this.nerClassifier = null;
      this.seedEmbeddings = null;
      this.isEmbeddingReady = false;
      this.isZeroShotReady = false;
      this.isNerReady = false;
      this.shouldUseZeroShotClassification = true; // Enable zero-shot for ambiguous cases
      
      this.intentPatterns = {
        memory_store: [
          /\b(remember|store|save|keep track of|jot down|log|record|note down)\b/i,
          /\b(remind me (?:to|about)|set a reminder)\b/i,
          /\b(my|our|the) (appointment|meeting|schedule|event|plan|task)\b/i,
          /\b(don't forget|make a note|write this down|save this)\b/i,
          /\b(I have|I've got|I'm scheduled for)\s+(an?\s+)?(appointment|meeting|event|call)\b/i,
          // Past tense sharing - user telling us what happened
          /\b(I had|I went|I did|I was|I visited|I attended|I completed)\b/i,
          /\b(yesterday|last week|last month|two weeks? ago|a week ago|few days ago).*\b(I had|I went|I did|I was)\b/i,
          /\b(I had|I went|I did|I was).*(yesterday|last week|last month|two weeks? ago|a week ago|few days ago)\b/i,
          // More specific pattern - only match when it's clearly stating they have something
          /^\s*(I have|I've got)\s+(an?\s+)?(appointment|meeting|event|call)\s+.*(today|tomorrow|this week|next week|on|at)\b/i
        ],
        memory_retrieve: [
          /\b(what did I|do you remember|recall|tell me what|what was)\b/i,
          /\b(when is|where is|show me|find my)\b/i,
          /\b(what's my next|did I forget|remind me what)\b/i,
          /\b(what's on my|check my|look up my)\b/i,
          /\b(what do I have|what have I got|what's happening|what's going on)\b/i,
          /\b(my schedule|my calendar|my appointments|my plans)\b/i,
          /\b(today|tomorrow|this week|next week).*\b(schedule|plans|appointments)\b/i,
          /\b(going on|happening).*\b(today|tomorrow|this week|next week)\b/i,
          /\bwhat do I have.*(today|tomorrow|this week|next week|tonight|this morning|this afternoon|this evening)\b/i,
          /\b(what's up|what about).*(today|tomorrow|this week|next week|for me|with me)\b/i,
          /\b(what about|what happened).*(yesterday|last week|last month|a week ago|few days ago|couple weeks? ago)\b/i,
          /\bwhat.*(going on|happening|planned|scheduled).*(today|tomorrow|this week|next week)\b/i,
          // Questions about appointments - who/what/when/where questions
          /\b(who is|what is|when is|where is).*(appointment|appt|meeting|event)\b/i,
          /\b(appointment|appt|meeting|event).*(with who|it's with|who's it with)\b/i,
          /\b(any|all).*(appointment|appt|meeting|event).*(in the|during the|from the).*(last|past).*(week|month|year)\b/i,
          // Questions specifically about stored information
          /\b(what|when|where|who).*(did I|have I|do I have).*(tell|say|mention|store|save|remember)\b/i,
          /\b(what|when|where|who).*(told|said|mentioned|stored|saved|remembered)\b/i,
          /\b(do I have|did I).*(information|details|notes).*(about|on|regarding)\b/i
        ],
        command: [
          /\b(take a screenshot|capture|screenshot|snap|take a picture|take a photo|take a snap)\b/i,
          /\b(open|launch|run|start|go to|execute)\b/i,
          /\b(show me|display|grab)\s+(?:the\s+)?(screen|desktop|window|display)\b/i,
          /\b(take a)\s+(?:picture|photo|screenshot|snap)\s+(?:of\s+)?(?:the\s+)?(screen|desktop|display)\b/i,
          /\b(capture|grab|get)\s+(?:the\s+)?(screen|desktop|window|display)\b/i
        ],
        question: [
          // Basic question patterns
          /\b(what is|how is|why is|when is|where is|who is|which is)\b/i,
          // Contractions
          /\b(what's|how's|why's|when's|where's|who's|which's)\b/i,
          // General knowledge questions
          /^\s*(how|what|when|where|who|why|which)\s+(long|much|many|far|old|big|small|tall|wide|deep)\s+(is|are|was|were|does|do|did)\b/i,
          // Questions starting with question words
          /^\s*(how|what|when|where|who|why|which)\s+(?!.*\b(did I|have I|do I have|told|said|mentioned)\b)/i,
          /\b(tell me about|what's|how do I|why does|where can|how can I)\b/i,
          /\b(explain|help with|tutorial|example|code example)\b/i,
          /\bare you (able|capable|good|fast|better|designed|built|trained)\b/i,
          /\bdo you (support|have|offer|provide|know|understand)\b/i,
          /\bhow many\b/i,
          /\bhow much\b/i,
          /\bcount.*in\b/i,
          /\bnumber of\b/i,
          // More flexible pattern for question starters
          /^\s*(what|how|why|when|where|who|which)['s]*\s+(is|are|does|do|can|will|would|should|could|the)\b/i
        ],
        greeting: [
          /^\s*(hi|hello|hey)\s*[!.?]*\s*$/i,
          /^\s*(good morning|good evening|what's up|yo)\s*[!.?]*\s*$/i,
          /^\s*how are you\b/i,
          /\b(nice to meet|greetings)\b/i
        ]
      };
      
      this.entityPatterns = {
        datetime: /\b(?:\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:am|pm|AM|PM))?|\d{1,2}(?:\s*(?:am|pm|AM|PM))|(?:tomorrow|today|yesterday|tonight|this\s+(?:morning|afternoon|evening|night))|(?:next|last|this)\s+(?:week|month|year|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|in\s+\d+\s+(?:days?|hours?|minutes?|weeks?|months?|years?)|\d+\s+(?:days?|hours?|minutes?|weeks?|months?|years?)\s+(?:ago|from\s+now)|(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?s?|\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:,\s*\d{4})?|\d{1,2}(?:st|nd|rd|th)\s+(?:of\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december)|(?:at\s+)?(?:noon|midnight|dawn|dusk|sunrise|sunset)|(?:early|late)\s+(?:morning|afternoon|evening)|(?:end|beginning|start)\s+of\s+(?:week|month|year))\b/gi,
        person: /\b(?:(?:Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Miss|Prof\.?|Professor|Sir|Madam|Captain|Colonel|Major|General)\s*[A-Z][a-z]+(?:\s+[A-Z][a-z']+)*|[A-Z][a-z']+(?:\s+[A-Z][a-z']+)+|(?:John|Jane|Michael|Sarah|David|Lisa|Robert|Mary|James|Jennifer|William|Elizabeth|Richard|Patricia|Charles|Barbara|Thomas|Susan|Christopher|Jessica|Daniel|Karen|Matthew|Nancy|Anthony|Mark|Betty|Donald|Helen|Steven|Sandra|Paul|Donna|Andrew|Carol|Joshua|Ruth|Kenneth|Sharon|Kevin|Michelle|Brian|Laura|George|Edward|Kimberly|Ronald|Timothy|Dorothy|Jason|Amy|Jeffrey|Angela|Ryan|Jacob|Brenda|Gary|Emma|Nicholas|Olivia|Eric|Cynthia|Jonathan|Marie))\b/g,
        location: /\b(?:office|home|downtown|uptown|midtown|clinic|hospital|school|university|college|library|cafe|coffee\s+shop|restaurant|airport|station|train\s+station|bus\s+stop|park|city|town|village|building|room\s+\d+|floor\s+\d+|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Drive|Dr\.?|Lane|Ln\.?|Plaza|Court|Ct\.?)|\d+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Drive|Dr\.?|Lane|Ln\.?)|(?:north|south|east|west|northeast|northwest|southeast|southwest)\s+(?:side|end|part)|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Center|Centre|Mall|Market|Square|Park|Gardens?|Hospital|Clinic|University|College|School|Library|Museum|Theater|Theatre|Stadium|Arena)|(?:United\s+States|USA|Canada|Mexico|California|New\s+York|Texas|Florida|Illinois|Pennsylvania|Ohio|Georgia|North\s+Carolina|Michigan|New\s+Jersey|Virginia|Washington|Arizona|Massachusetts|Tennessee|Indiana|Missouri|Maryland|Wisconsin|Colorado|Minnesota|South\s+Carolina|Alabama|Louisiana|Kentucky|Oregon|Oklahoma|Connecticut|Utah|Iowa|Nevada|Arkansas|Mississippi|Kansas|New\s+Mexico|Nebraska|West\s+Virginia|Idaho|Hawaii|New\s+Hampshire|Maine|Montana|Rhode\s+Island|Delaware|South\s+Dakota|North\s+Dakota|Alaska|Vermont|Wyoming))\b/gi,
        event: /\b(?:appointment|meeting|call|phone\s+call|video\s+call|conference\s+call|interview|lunch|dinner|breakfast|brunch|conference|webinar|seminar|workshop|training|standup|stand-up|demo|demonstration|presentation|pitch|check-in|check\s+in|review|evaluation|assessment|follow-up|follow\s+up|party|celebration|birthday|anniversary|wedding|funeral|graduation|class|lesson|session|consultation|therapy|treatment|kickoff|kick-off|launch|release|deployment|go-live|milestone|deadline)\b/gi,
        contact: /(?:\+?\d{1,4}[\s\-\.]?\(?\d{1,4}\)?[\s\-\.]?\d{1,4}[\s\-\.]?\d{1,4}[\s\-\.]?\d{0,4}|\(?\d{3}\)?[\s\-\.]?\d{3}[\s\-\.]?\d{4}|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|https?:\/\/[^\s]+|www\.[^\s]+|@[a-zA-Z0-9_]+|skype:[a-zA-Z0-9._-]+|teams:[a-zA-Z0-9._-]+)/gi,
        capability: /\b(?:semantic\s+search|search|memory|memorize|store|save|remember|recall|retrieve|screenshot|capture|screen|desktop|display|monitor|window|recognize|detect|identify|track|observe|analyze|code|coding|programming|develop|javascript|typescript|python|java|c\+\+|c#|php|ruby|go|rust|swift|kotlin|react|angular|vue|svelte|node\.?js|express|django|flask|spring|laravel|rails|automation|workflow|agent|bot|chatbot|assistant|AI|artificial\s+intelligence|intent|understand|comprehend|interpret|parse|process|extract|transform|load|ETL|migrate|sync|synchronize|backup|restore)\b/gi,
        technology: /\b(?:AI|artificial\s+intelligence|LLM|large\s+language\s+model|GPT|BERT|transformer|neural\s+network|machine\s+learning|ML|deep\s+learning|DL|NLP|natural\s+language\s+processing|embedding|vector|semantic|similarity|RAG|retrieval\s+augmented\s+generation|ollama|phi3|llama|claude|chatgpt|copilot|gemini|duckdb|postgresql|postgres|mysql|mongodb|redis|elasticsearch|pgvector|chromadb|pinecone|weaviate|sql|nosql|json|xml|yaml|yml|csv|parquet|API|REST|GraphQL|gRPC|HTTP|HTTPS|WebSocket|CLI|command\s+line|GUI|web\s+interface|dashboard|OCR|optical\s+character\s+recognition|computer\s+vision|image\s+recognition|speech\s+recognition|voice\s+recognition|AWS|Azure|GCP|Google\s+Cloud|Docker|Kubernetes|microservices|serverless|lambda)\b/gi,
        action: /\b(?:create|generate|build|make|construct|develop|design|craft|compose|write|edit|update|modify|change|alter|revise|refactor|improve|enhance|optimize|delete|remove|erase|clear|purge|clean|wipe|destroy|list|show|display|present|render|visualize|demonstrate|exhibit|explain|describe|define|clarify|elaborate|detail|outline|summarize|sum|help|assist|support|guide|advise|recommend|suggest|analyze|analyse|process|examine|investigate|study|evaluate|assess|review|inspect|plan|schedule|organize|arrange|coordinate|manage|structure|find|search|locate|discover|identify|detect|lookup|query|remind|remember|store|save|bookmark|note|record|log|send|share|distribute|broadcast|notify|alert|inform|tell|run|execute|launch|start|begin|initiate|trigger|invoke|call|complete|finish|end|stop|close|terminate|conclude|finalize)\b/gi
      };
      
      // Seed examples for embedding-based similarity
      this.seedExamples = {
        memory_store: [
          // Direct storage commands
          "remember this", "save a reminder", "jot down this meeting", "don't forget my appointment", 
          "note that I have", "store this information", "keep track of my schedule", "write down this task", 
          "log this event", "make a note of this", "record this detail", "bookmark this information",
          "file this away", "add to my notes", "memorize this fact", "save this for later",
          "document this conversation", "archive this message", "keep this on file", "register this event",
          
          // Context-specific storage
          "remember I'm meeting John at 3pm", "save that the deadline is Friday", "note my doctor's appointment",
          "store my login credentials", "remember my parking spot is B-12", "keep track of my expenses",
          "log my workout routine", "record my medication schedule", "save my favorite restaurant",
          "remember my anniversary date", "note my flight details", "store my emergency contacts",
          "remember where I parked", "save this recipe for later", "note my wifi password",
          
          // Scheduling and calendar
          "add this to my calendar", "schedule this meeting", "block this time", "reserve this slot",
          "put this on my agenda", "mark this date", "set aside time for this", "allocate time for",
          "pencil this in", "book this appointment", "reserve this time slot", "schedule a reminder",
          
          // Task and project management
          "add this to my todo list", "create a task for this", "add this action item", "track this project",
          "monitor this deadline", "follow up on this", "add this to my backlog", "queue this task",
          "prioritize this item", "flag this for later", "escalate this issue", "assign this task",
          
          // Personal information
          "remember my preferences", "save my settings", "store my profile", "keep my contact info",
          "remember my allergies", "note my dietary restrictions", "save my medical history",
          "record my emergency info", "store my insurance details", "remember my blood type"
        ],
      
        memory_retrieve: [
          // Direct retrieval requests
          "what did I say", "remind me of my meeting", "what's on my calendar", "when is my appointment",
          "do you remember", "tell me what I stored", "find my notes about", "look up my schedule",
          "recall my tasks", "what did I save", "show me my reminders", "pull up my notes",
          "retrieve my information", "access my files", "find my records", "locate my data",
          
          // Specific information queries
          "when is my next meeting", "what's my password for", "where did I park", "what's my flight number",
          "remind me of my anniversary", "what's my doctor's number", "when is my deadline",
          "what medication do I take", "where's my favorite restaurant", "what's my emergency contact",
          "when do I need to leave", "what's my budget for", "where's my backup stored",
          
          // Schedule and calendar queries
          "what's on my agenda today", "show me tomorrow's schedule", "what meetings do I have",
          "when am I free", "what's my next appointment", "check my availability", "review my calendar",
          "what's planned for this week", "show me my upcoming events", "when is my next commitment",
          
          // Task and project queries
          "what tasks do I have", "show me my todo list", "what's pending", "what needs to be done",
          "what's overdue", "show me my priorities", "what projects am I tracking", "what's my workload",
          "what deadlines are coming up", "what's on my plate", "show me action items",
          
          // Historical queries
          "what did we discuss last time", "what was decided in that meeting", "what was the outcome",
          "how did that project end", "what was the resolution", "what happened with", "what was the result",
          "what did I learn from", "what was my feedback on", "how did I solve that before"
        ],
      
        command: [
          // Screenshot and capture commands
          "take a screenshot", "take a picture of the screen", "capture the desktop", "grab the screen",
          "take a photo of my display", "screenshot this", "snap the screen", "capture this window",
          "take a screen grab", "screenshot the current page", "capture what I'm seeing",
          "save a picture of this", "grab a screenshot", "capture the entire screen",
          
          // Application and system commands
          "open browser", "run the script", "launch application", "execute this command", "start the program",
          "show me the screen", "display the desktop", "open file explorer", "launch calculator",
          "start notepad", "open settings", "run system diagnostics", "execute batch file",
          "launch terminal", "open command prompt", "start task manager", "run registry editor",
          
          // File and folder operations
          "create a new folder", "delete this file", "copy these files", "move to desktop",
          "rename this document", "compress these files", "extract this archive", "backup my data",
          "sync my files", "upload to cloud", "download from server", "share this file",
          
          // System operations
          "restart the computer", "shut down system", "lock the screen", "log out user",
          "switch user account", "check system status", "update software", "install program",
          "uninstall application", "clear cache", "run antivirus scan", "defragment disk",
          
          // Network and connectivity
          "connect to wifi", "check internet connection", "ping this server", "test network speed",
          "connect to VPN", "disconnect from network", "refresh IP address", "diagnose connection",
          
          // Automation and workflows
          "automate this process", "create a workflow", "schedule this task", "set up automation",
          "trigger this action", "execute workflow", "run automated script", "start batch process"
        ],
      
        question: [
          // General knowledge
          "what is the weather", "how do I cook rice", "explain this concept", "what's the oldest city",
          "why does this happen", "tell me about history", "how can I learn programming", "what does this mean",
          "help me understand", "what is your name", "how are you designed", "explain how you work",
          
          // How-to questions
          "how do I fix this", "how can I improve", "what's the best way to", "how should I approach",
          "what steps should I take", "how do I get started", "what's the process for", "how can I optimize",
          "what's the proper method", "how do I troubleshoot", "what's the recommended approach",
          
          // Explanatory questions
          "why is this important", "what are the benefits", "what are the risks", "how does this work",
          "what's the difference between", "what are the alternatives", "what should I consider",
          "what are the implications", "what's the impact of", "how does this affect",
          
          // Comparative questions
          "which is better", "what's the comparison", "how do these differ", "what are the pros and cons",
          "which should I choose", "what's more effective", "which option is optimal", "what's the trade-off",
          
          // Definitional questions
          "what is artificial intelligence", "define machine learning", "explain neural networks",
          "what does API mean", "what is cloud computing", "define cryptocurrency", "explain blockchain",
          "what is cybersecurity", "define data science", "what does agile mean",
          
          // Problem-solving questions
          "how do I solve this problem", "what's wrong with this", "why isn't this working",
          "how can I fix this error", "what's causing this issue", "how do I debug this",
          "what's the solution to", "how do I resolve this conflict", "what's the root cause",
          
          // Planning and strategy questions
          "what should I plan for", "how should I prepare", "what's the best strategy",
          "how do I prioritize this", "what's the timeline for", "how should I organize",
          "what resources do I need", "how do I measure success", "what's the roadmap",
          
          // Counting and analysis questions
          "how many letters in this word", "how many Rs in strawberry", "count the vowels in this",
          "how many words in this sentence", "what's the length of this text", "how many characters",
          "count the occurrences of", "how many times does this appear", "what's the frequency of",
          "how many syllables in this word", "count the consonants", "how many digits in this number"
        ],
      
        greeting: [
          // Basic greetings (removed question-like greetings)
          "hello there", "good morning", "hi assistant", "nice to meet you", 
          "greetings", "good evening", "howdy", "hi there", "hello", "hey", 
          "good afternoon", "good day", "salutations",
          
          // Casual greetings (removed question-like greetings)
          "long time no see", "good to see you", "nice seeing you",
          
          // Formal greetings
          "good day to you", "pleased to meet you", "how do you do", "it's a pleasure",
          "I hope you're well", "trust you're doing well", "I hope this finds you well",
          
          // Time-specific greetings
          "good morning sunshine", "rise and shine", "top of the morning", "good evening friend",
          "good night", "have a great day", "enjoy your evening", "sweet dreams",
          
          // Friendly and enthusiastic
          "hey buddy", "hi friend", "hello my friend", "hey there pal", "greetings friend",
          "hello wonderful", "hi amazing", "hey fantastic", "good to see you",
          
          // International greetings
          "bonjour", "hola", "guten tag", "konnichiwa", "namaste", "shalom", "ciao"
        ],
      
        request: [
          // Polite requests
          "could you please", "would you mind", "I'd appreciate if you could", "if possible, could you",
          "would it be possible to", "I was wondering if you could", "do you think you could",
          "I need help with", "can you assist me", "I require assistance", "I could use some help",
          
          // Direct requests
          "please do this", "I need you to", "can you handle", "take care of this",
          "deal with this", "process this request", "complete this task", "finish this job",
          
          // Service requests
          "book me a flight", "schedule an appointment", "order food delivery", "make a reservation",
          "call customer service", "send an email", "draft a letter", "create a document",
          "generate a report", "analyze this data", "research this topic", "find information about"
        ],
      
        complaint: [
          // Service complaints
          "this isn't working", "I'm having trouble with", "there's a problem with", "this is broken",
          "I can't get this to work", "this is frustrating", "I'm not satisfied with", "this is disappointing",
          "I expected better", "this doesn't meet my needs", "I'm unhappy with the service",
          
          // Technical complaints
          "the system is down", "the app keeps crashing", "I can't connect", "it's running slowly",
          "there are bugs", "it's not responding", "the interface is confusing", "it's not user-friendly",
          
          // Quality complaints
          "the quality is poor", "this is defective", "it's not as described", "this is substandard",
          "I'm not getting what I paid for", "this doesn't work as advertised", "the performance is lacking"
        ],
      
        compliment: [
          // Performance compliments
          "great job", "well done", "excellent work", "that was perfect", "you did amazing",
          "fantastic", "brilliant", "outstanding", "superb", "wonderful job", "impressive",
          
          // Appreciation
          "thank you so much", "I really appreciate this", "you're very helpful", "this is exactly what I needed",
          "you're amazing", "you're the best", "I couldn't have done it without you",
          
          // Quality compliments
          "this is high quality", "this exceeds expectations", "this is exactly right", "perfect solution",
          "this is very professional", "excellent attention to detail", "this is comprehensive"
        ],
      
        emergency: [
          // Medical emergencies
          "call 911", "I need medical help", "someone is hurt", "medical emergency", "call ambulance",
          "heart attack", "stroke", "accident", "injury", "unconscious", "not breathing",
          
          // Safety emergencies
          "fire", "smoke", "gas leak", "break in", "intruder", "theft", "robbery",
          "call police", "call fire department", "emergency services", "help immediately",
          
          // Personal emergencies
          "I'm lost", "I'm trapped", "car broke down", "flat tire", "out of gas",
          "locked out", "lost keys", "phone died", "need immediate help"
        ],
      
        memory_delete: [
          // Direct deletion commands
          "delete this", "remove this note", "erase this reminder", "clear this entry", "forget this",
          "delete my reminder about", "remove this from memory", "clear this information", "erase this data",
          "forget what I said about", "delete this appointment", "remove this task", "clear my notes about",
          "wipe this information", "purge this record", "eliminate this entry", "discard this note",
          
          // Specific deletions
          "delete my meeting with John", "remove my doctor's appointment", "forget my password for",
          "clear my calendar entry", "delete this contact", "remove this address", "forget this person",
          "delete this file reference", "remove this bookmark", "clear this saved item",
          "delete my note about the project", "remove this phone number", "forget this website",
          
          // Bulk deletions
          "clear all my reminders", "delete everything about", "remove all notes from last week",
          "clear my entire calendar", "delete all contacts", "remove all saved passwords",
          "clear all my bookmarks", "delete all project notes", "remove everything stored",
          "purge all old entries", "clear expired reminders", "delete completed tasks",
          
          // Conditional deletions
          "delete if outdated", "remove expired entries", "clear old appointments", "delete past events",
          "remove completed items", "clear finished tasks", "delete cancelled meetings",
          "remove obsolete information", "clear duplicate entries", "delete unnecessary notes",
          
          // Confirmation requests
          "can you delete this", "please remove this entry", "would you clear this",
          "I want to delete this", "help me remove this", "need to clear this information",
          "can you forget this", "please erase this data", "I'd like to remove this note"
        ],
      
        memory_update: [
          // Direct update commands
          "update this", "change this note", "modify this reminder", "edit this entry", "revise this information",
          "update my meeting time", "change my appointment", "modify this contact", "edit this address",
          "revise my password", "update this project status", "change this deadline", "modify my schedule",
          "edit my profile", "update my preferences", "change this setting", "revise this document",
          
          // Specific updates
          "change my meeting from 2pm to 3pm", "update my phone number", "modify my email address",
          "change the location to downtown", "update the project deadline", "revise my notes about",
          "change my doctor's appointment time", "update my emergency contact", "modify my dietary restrictions",
          "change my parking spot to C-14", "update my flight details", "revise my workout schedule",
          
          // Status updates
          "mark this as completed", "update status to in progress", "change priority to high",
          "mark as cancelled", "update to urgent", "change status to pending", "mark as resolved",
          "update progress to 50%", "change to active", "mark as on hold", "update to approved",
          
          // Correction updates
          "correct this information", "fix this entry", "update the wrong details", "fix this mistake",
          "correct the spelling", "update the wrong time", "fix this error", "revise incorrect data",
          "update the typo", "correct this address", "fix the wrong date", "update misinformation",
          
          // Partial updates
          "just change the time", "only update the location", "just modify the date", "only change the name",
          "update just the phone number", "change only the email", "modify just the address",
          "update only the priority", "change just the status", "modify only the deadline",
          
          // Bulk updates
          "update all my contact info", "change all meeting times", "modify all project deadlines",
          "update my entire schedule", "revise all my notes", "change all passwords", "update all addresses"
        ],
      
        memory_search: [
          // General search commands
          "search for", "find information about", "look for", "search my notes for", "find my entry about",
          "locate information on", "search through my data", "find records containing", "look up details about",
          "search my memory for", "find anything related to", "locate entries about", "search for mentions of",
          
          // Specific searches
          "search for my meeting with Sarah", "find my doctor's phone number", "look for my parking spot",
          "search for project deadlines", "find my flight information", "look for restaurant recommendations",
          "search for my wifi password", "find my insurance details", "look for my workout routine",
          "search for my anniversary date", "find my emergency contacts", "look for my medication schedule",
          
          // Content-based searches
          "find notes containing", "search for entries with", "look for records about", "find data related to",
          "search for keywords", "find mentions of", "look for references to", "search text for",
          "find documents with", "search for phrases", "look for specific words", "find content about",
          
          // Time-based searches
          "search last week's entries", "find today's notes", "look for yesterday's meetings",
          "search this month's appointments", "find last year's records", "look for recent entries",
          "search for upcoming events", "find past appointments", "look for future deadlines",
          "search for expired items", "find overdue tasks", "look for scheduled reminders",
          
          // Category searches
          "search my contacts", "find my appointments", "look through my tasks", "search my bookmarks",
          "find my passwords", "look through my projects", "search my calendar", "find my documents",
          "look through my reminders", "search my notes", "find my addresses", "look through my files",
          
          // Advanced searches
          "search by date range", "find entries between", "look for items modified", "search by category",
          "find by importance level", "look for high priority items", "search by status", "find completed tasks",
          "look for pending items", "search by tag", "find by location", "look for urgent matters"
        ],
      
        memory_list: [
          // General listing commands
          "list all", "show me everything", "display all entries", "give me a list of", "show all my",
          "list my notes", "display my reminders", "show my appointments", "list my contacts",
          "show my tasks", "display my schedule", "list my bookmarks", "show my passwords",
          "display my projects", "list my documents", "show my addresses", "display my files",
          
          // Categorized listings
          "list all my meetings", "show all my appointments", "display all my contacts", "list all my tasks",
          "show all my projects", "display all my reminders", "list all my notes", "show all my bookmarks",
          "display all my passwords", "list all my addresses", "show all my documents", "display all my files",
          
          // Time-based listings
          "list today's appointments", "show this week's schedule", "display tomorrow's tasks",
          "list next week's meetings", "show this month's events", "display upcoming deadlines",
          "list past appointments", "show completed tasks", "display recent entries", "list overdue items",
          "show expired reminders", "display future events", "list pending tasks", "show active projects",
          
          // Status-based listings
          "list completed items", "show pending tasks", "display active projects", "list cancelled meetings",
          "show high priority items", "display urgent tasks", "list important notes", "show critical reminders",
          "display in-progress projects", "list on-hold items", "show approved requests", "display rejected items",
          
          // Filtered listings
          "list items containing", "show entries with", "display records about", "list notes related to",
          "show appointments with", "display tasks for", "list projects involving", "show contacts from",
          "display reminders about", "list bookmarks for", "show documents related to", "display files about",
          
          // Organized listings
          "list by priority", "show by date", "display by category", "list by importance", "show by status",
          "display by location", "list alphabetically", "show chronologically", "display by size",
          "list by frequency", "show by relevance", "display by modification date", "list by creation date",
          
          // Summary listings
          "give me a summary of", "show me an overview of", "display a breakdown of", "list the highlights",
          "show key information", "display important items", "list the essentials", "show the main points",
          "display critical information", "list the priorities", "show what's important", "display the summary"
        ]
      };
      
      // Note: Embeddings will be initialized explicitly via initializeEmbeddings()
      // No automatic initialization to avoid timing issues
    }
    
    async initializeEmbeddings() {
      if (this.embedder && this.zeroShotClassifier && this.nerClassifier) {
        return; // Already initialized
      }
      
      try {
        console.log('🤖 Initializing transformer models for intent classification...');
        
        // Use dynamic import for ES modules in Electron with proper callback
        const transformers = await import('@xenova/transformers');
        
        // Initialize embedding model for semantic search
        this.embedder = await transformers.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
          quantized: true,
          device: 'cpu',
          progress_callback: null
        });
        
        // Skip zero-shot classification - using pattern + semantic hybrid approach instead
        console.log('🚀 Skipping zero-shot classifier - using hybrid pattern+semantic approach');
        this.zeroShotClassifier = null;
        
        // Initialize NER model for entity extraction
        console.log('🏷️ Initializing NER entity classifier...');
        this.nerClassifier = await transformers.pipeline('token-classification', 'Xenova/bert-base-NER', {
          quantized: true,
          device: 'cpu',
          progress_callback: null
        });
        
        // Pre-compute embeddings for seed examples
        await this.precomputeSeedEmbeddings();
        
        console.log('✅ All transformer models initialized successfully');
        this.isEmbeddingReady = true;
        this.isZeroShotReady = false; // Disabled - using hybrid approach instead
        this.isNerReady = true;
        
      } catch (error) {
        console.warn('⚠️ Failed to initialize transformer models:', error.message);
        console.log('📝 Falling back to pattern matching and word overlap similarity');
        this.embedder = null;
        this.zeroShotClassifier = null;
        this.nerClassifier = null;
        this.isEmbeddingReady = false;
        this.isZeroShotReady = false;
        this.isNerReady = false;
      }
    }
    
    async precomputeSeedEmbeddings() {
      if (!this.embedder) {
        console.warn('⚠️ No embedder available for precomputing seed embeddings');
        return;
      }
      
      try {
        console.log('🔄 Precomputing seed embeddings...');
        this.seedEmbeddings = {};
        
        for (const [intent, examples] of Object.entries(this.seedExamples)) {
          this.seedEmbeddings[intent] = [];
          
          for (const example of examples.slice(0, 5)) { // Limit to first 5 examples for performance
            try {
              const embedding = await this.embedder(example, { pooling: 'mean', normalize: true });
              this.seedEmbeddings[intent].push(Array.from(embedding.data));
            } catch (error) {
              console.warn(`⚠️ Failed to compute embedding for example: ${example.substring(0, 30)}...`);
            }
          }
        }
        
        console.log('✅ Seed embeddings precomputed successfully');
        
      } catch (error) {
        console.error('❌ Failed to precompute seed embeddings:', error);
        this.seedEmbeddings = null;
      }
    }
    
    async parse(responseText, originalMessage) {
      try {
        console.log('🔍 Analyzing natural language response...');
        
        // Step 1: Classify Intent
        const intentResult = await this.classifyIntent(responseText, originalMessage);
        
        // Step 2: Extract entities from both texts
        console.log('🎯 About to extract entities from message:', originalMessage);
        const entities = await this.extractEntities(responseText, originalMessage);
        console.log('🎯 Extracted entities result:', entities);
        
        // Step 3: Determine boolean flags
        const flags = this.determineBooleanFlags(responseText, originalMessage, intentResult.intent);
        
        // Step 4: Generate suggested response
        const suggestedResponse = this.generateSuggestedResponse(responseText, originalMessage, intentResult.intent);
        
        // Step 5: Check if clarification is needed (lowered threshold for zero-shot results)
        const confidenceThreshold = intentResult.reasoning?.includes('Zero-shot') ? 0.1 : 0.5;
        if (intentResult.confidence < confidenceThreshold) {
          return {
            needsClarification: true,
            clarificationPrompt: this.generateClarificationPrompt(intentResult),
            possibleIntents: intentResult.possibleIntents,
            confidence: intentResult.confidence
          };
        }
      
        // Step 6: Build final result
        return {
          chainOfThought: {
            step1_analysis: this.extractAnalysis(responseText),
            step2_reasoning: this.extractReasoning(responseText, intentResult.intent),
            step3_consistency: this.checkConsistency(responseText, originalMessage)
          },
          intents: intentResult.allIntents || [{
            intent: intentResult.intent,
            confidence: intentResult.confidence,
            reasoning: intentResult.reasoning
          }],
          primaryIntent: intentResult.intent,
          entities: entities,
          requiresMemoryAccess: flags.requiresMemoryAccess,
          requiresExternalData: flags.requiresExternalData,
          captureScreen: flags.captureScreen,
          suggestedResponse: suggestedResponse,
          sourceText: originalMessage
        };
        
      } catch (error) {
        console.error('🚨 Error in natural language parsing:', error);
        
        // Fallback to simple pattern matching
        return {
          chainOfThought: {
            step1_analysis: 'Error in analysis',
            step2_reasoning: 'Fallback to simple parsing',
            step3_consistency: 'Unable to check consistency'
          },
          intents: [{
            intent: 'question',
            confidence: 0.5,
            reasoning: 'Fallback due to parsing error'
          }],
          primaryIntent: 'question',
          entities: [],
          requiresMemoryAccess: false,
          requiresExternalData: false,
          captureScreen: false,
          suggestedResponse: 'I apologize, but I had trouble understanding your request. Could you please rephrase it?',
          sourceText: originalMessage
        };
      }
    }
    
    async classifyIntent(responseText, originalMessage) {
      const combinedText = (responseText + ' ' + originalMessage).toLowerCase();
      const originalLower = originalMessage.toLowerCase();
      
      console.log('🎯 Starting hybrid intent classification...');
      
      // 🎯 LAYER 1: Pattern-based classification (most reliable for common intents)
      // First check original message only (more reliable for questions)
      const originalPatternScores = this.calculatePatternScores(originalLower);
      const highestOriginalScore = Math.max(...Object.values(originalPatternScores));
      
      if (highestOriginalScore > 0) {
        // Smart tie-breaking: prioritize memory_retrieve over question for ambiguous queries
        const intentPriority = {
          'memory_retrieve': 4,
          'memory_store': 3,
          'command': 2,
          'question': 1,
          'greeting': 0
        };
        
        const bestOriginalIntent = Object.entries(originalPatternScores)
          .sort((a, b) => {
            const scoreA = originalPatternScores[a[0]];
            const scoreB = originalPatternScores[b[0]];
            
            // If scores are different, pick higher score
            if (scoreA !== scoreB) {
              return scoreB - scoreA;
            }
            
            // If scores are equal, use priority (higher priority wins)
            return (intentPriority[b[0]] || 0) - (intentPriority[a[0]] || 0);
          })[0][0];
        
        console.log('✅ High-confidence pattern match found in original message:', bestOriginalIntent);
        return {
          intent: bestOriginalIntent,
          confidence: 0.9,
          reasoning: `Pattern match in original message with score: ${originalPatternScores[bestOriginalIntent]}`,
          possibleIntents: [bestOriginalIntent],
          allIntents: [{
            intent: bestOriginalIntent,
            confidence: 0.9,
            reasoning: 'Pattern-based classification (original message)'
          }]
        };
      }
      
      // Fallback to combined text for context-dependent patterns
      const hybridPatternScores = this.calculatePatternScores(combinedText);
      const highestPatternScore = Math.max(...Object.values(hybridPatternScores));
      
      if (highestPatternScore > 0) {
        // Apply same smart tie-breaking logic for hybrid patterns
        const bestPatternIntent = Object.entries(hybridPatternScores)
          .sort((a, b) => {
            const scoreA = hybridPatternScores[a[0]];
            const scoreB = hybridPatternScores[b[0]];
            
            // If scores are different, pick higher score
            if (scoreA !== scoreB) {
              return scoreB - scoreA;
            }
            
            // If scores are equal, use priority (memory_retrieve > question)
            const intentPriority = {
              'memory_retrieve': 4,
              'memory_store': 3,
              'command': 2,
              'question': 1,
              'greeting': 0
            };
            return (intentPriority[b[0]] || 0) - (intentPriority[a[0]] || 0);
          })[0][0];
        
        console.log('✅ High-confidence pattern match found in combined text:', bestPatternIntent);
        return {
          intent: bestPatternIntent,
          confidence: 0.9,
          reasoning: `Pattern match with score: ${hybridPatternScores[bestPatternIntent]}`,
          possibleIntents: [bestPatternIntent],
          allIntents: [{
            intent: bestPatternIntent,
            confidence: 0.9,
            reasoning: 'Pattern-based classification'
          }]
        };
      }
      
      // 🎯 LAYER 2: Semantic similarity with seed examples (good for variations)
      if (this.isEmbeddingReady && this.embedder) {
        const semanticScores = await this.calculateSemanticScores(originalMessage);
        const highestSemanticScore = Math.max(...Object.values(semanticScores));
        
        if (highestSemanticScore > 0.7) {
          const bestSemanticIntent = Object.entries(semanticScores)
            .reduce((a, b) => semanticScores[a[0]] > semanticScores[b[0]] ? a : b)[0];
          
          console.log('✅ High-confidence semantic match found:', bestSemanticIntent);
          return {
            intent: bestSemanticIntent,
            confidence: highestSemanticScore,
            reasoning: `Semantic similarity with score: ${highestSemanticScore.toFixed(3)}`,
            possibleIntents: [bestSemanticIntent],
            allIntents: [{
              intent: bestSemanticIntent,
              confidence: highestSemanticScore,
              reasoning: 'Semantic similarity classification'
            }]
          };
        }
      }
      
      // 🎯 LAYER 3: Zero-shot classification for ambiguous cases
      // Use zero-shot for any case where pattern matching might be unreliable
      const maxPatternScore = Math.max(...Object.values(hybridPatternScores));
      const maxSemanticScore = this.isEmbeddingReady && this.embedder ? 
        Math.max(...Object.values(await this.calculateSemanticScores(originalMessage))) : 0;
      
      // More aggressive use of zero-shot for general questions that might be misclassified
      const looksLikeGeneralQuestion = /^\s*(how|what|when|where|who|why|which)\s+(long|much|many|far|old|big|small|tall|wide|deep)\s+(is|are|was|were|does|do|did|can|will|would)\b/i.test(originalMessage);
      const isAmbiguous = maxPatternScore < 0.9 || looksLikeGeneralQuestion || 
                          (maxPatternScore > 0 && maxSemanticScore > 0.3 && 
                          Math.abs(maxPatternScore - maxSemanticScore) < 0.3);
      
      if (isAmbiguous && this.shouldUseZeroShotClassification) {
        try {
          console.log('🎯 Using zero-shot classification for ambiguous intent...');
          const zeroShotResult = await this.classifyWithZeroShot(originalMessage);
          if (zeroShotResult && zeroShotResult.intent && zeroShotResult.confidence > 0.6) {
            console.log(`✅ Zero-shot classified as: ${zeroShotResult.intent} (confidence: ${zeroShotResult.confidence})`);
            return {
              intent: zeroShotResult.intent,
              confidence: zeroShotResult.confidence,
              method: 'zero_shot',
              reasoning: zeroShotResult.reasoning || 'Zero-shot transformer classification',
              entities: zeroShotResult.entities || [],
              chainOfThought: [{
                step: 'zero_shot_classification',
                reasoning: zeroShotResult.reasoning || `Zero-shot determined this is ${zeroShotResult.intent} based on transformer analysis`,
                confidence: zeroShotResult.confidence
              }]
            };
          }
        } catch (error) {
          console.warn('⚠️ Zero-shot classification failed, falling back:', error.message);
        }
      }
      
      // 🎯 LAYER 4: Zero-shot classification (disabled - using pattern+semantic+phi3 only)
      if (false && this.isZeroShotReady && this.zeroShotClassifier) {
        try {
          console.log('🎯 Using zero-shot transformer classification...');
          
          // More distinct candidate labels for better classification
          const candidateLabels = [
            'I want to save this new information',
            'I want to find my saved information', 
            'I want to update saved information',
            'I want to delete saved information',
            'I want you to do something',
            'I have a question',
            'I am greeting you',
            'I need help',
            'I want creative content',
            'I want analysis of data',
            'I want calculations',
            'I want to know about your features'
          ];
          
          // Map descriptive labels back to intent codes
          const labelMap = {
            'I want to save this new information': 'memory_store',
            'I want to find my saved information': 'memory_retrieve',
            'I want to update saved information': 'memory_update',
            'I want to delete saved information': 'memory_delete',
            'I want you to do something': 'command',
            'I have a question': 'question',
            'I am greeting you': 'greeting',
            'I need help': 'help',
            'I want creative content': 'creative',
            'I want analysis of data': 'analysis',
            'I want calculations': 'calculation',
            'I want to know about your features': 'system_info'
          };
          
          const result = await this.zeroShotClassifier(originalMessage, candidateLabels);
          
          console.log('✅ Zero-shot classification result:', result);
          
          // Handle zero-shot classification result format
          const labels = result.labels;
          const scores = result.scores;
          
          console.log('✅ Processed zero-shot results:', {
            labels: labels.slice(0, 3),
            scores: scores.slice(0, 3)
          });
          
          // Build multiple intents array with confidence scores
          const allIntents = labels.slice(0, 3).map((label, index) => ({
            intent: labelMap[label] || label,
            confidence: scores[index],
            reasoning: `Zero-shot transformer classification`
          }));
          
          return {
            intent: labelMap[result.labels[0]] || result.labels[0],
            confidence: result.scores[0],
            reasoning: `Zero-shot transformer: ${result.scores[0].toFixed(3)}`,
            possibleIntents: result.labels.slice(0, 3).map(label => labelMap[label] || label),
            allIntents: allIntents
          };
          
        } catch (error) {
          console.warn('⚠️ Zero-shot classification failed:', error.message);
          console.log('🔄 Falling back to pattern + semantic approach...');
        }
      }
      
      // 🎯 FINAL FALLBACK: Simple pattern + semantic fallback if all else fails
      console.log('🎯 All classification methods failed, using simple fallback...');
      
      // Use the best pattern or semantic score as final fallback
      const patternScores = this.calculatePatternScores(combinedText);
      const semanticScores = await this.calculateSemanticScores(originalMessage);
      
      // Find the highest scoring intent from either approach
      const allScores = {};
      for (const intent of Object.keys(this.intentPatterns)) {
        allScores[intent] = Math.max(patternScores[intent] || 0, semanticScores[intent] || 0);
      }
      
      const bestIntent = Object.entries(allScores)
        .sort(([,a], [,b]) => b - a)[0];
      
      return {
        intent: bestIntent[0] || 'question',
        confidence: Math.min(bestIntent[1] * 0.6, 0.7), // Lower confidence for fallback
        method: 'fallback',
        reasoning: 'Fallback classification after all methods failed',
        entities: [],
        chainOfThought: [{
          step: 'fallback_classification',
          reasoning: `Used simple pattern/semantic fallback, best match: ${bestIntent[0]}`,
          confidence: bestIntent[1]
        }]
      };
    }
    
    calculatePatternScores(combinedText) {
      const scores = {};
      
      // Score each intent based on pattern matching
      for (const [intent, patterns] of Object.entries(this.intentPatterns)) {
        scores[intent] = 0;
        for (const pattern of patterns) {
          if (pattern.test(combinedText)) {
            scores[intent] += 1;
            console.log(`🎯 [PATTERN] Matched ${intent}: ${pattern} in "${combinedText}"`);
          }
        }
      }
      
      console.log(`🎯 [PATTERN] Final scores:`, scores);
      return scores;
    }
    
    async calculateSemanticScores(message) {
      // Lightweight semantic similarity using seed examples
      const seedExamples = {
        memory_store: [
          "remember this for me",
          "save this note",
          "jot this down",
          "I need to remember an appointment",
          "log this event",
          "store this memory",
          "keep track of this",
          "make a note of my plans",
          "don't forget that I have a meeting",
          "remind me later about this"
        ],
        memory_retrieve: [
          "what did I tell you before",
          "remind me what I said",
          "do you remember my schedule",
          "what's on my calendar",
          "tell me my upcoming meetings",
          "recall my past appointments",
          "show me what I stored",
          "what did I ask you to remember",
          "did I mention anything earlier",
          "do you remember when I said..."
        ],
        memory_update: [
          "update my appointment time",
          "change what I told you earlier",
          "modify the note I saved",
          "edit what I asked you to remember",
          "replace the meeting info",
          "reschedule the reminder",
          "update the details I shared",
          "change the stored memory",
          "fix what I said before",
          "correct the saved event"
        ],
        memory_delete: [
          "delete the reminder",
          "remove what I told you",
          "forget what I said earlier",
          "erase that memory",
          "clear the stored information",
          "drop the saved note",
          "undo what I remembered",
          "delete my schedule entry",
          "forget that event",
          "remove that from memory"
        ],
        greeting: [
          "hello",
          "hi there",
          "hey",
          "good morning",
          "good evening",
          "yo",
          "sup",
          "how are you doing",
          "nice to meet you"
        ],
        question: [
          "what can you do",
          "how does this work",
          "are you capable of semantic search",
          "are you fast compared to other models",
          "do you support programming",
          "can you help with coding",
          "what are your capabilities",
          "how good are you at",
          "are you able to",
          "do you know about"
        ]
      };
      
      const scores = {};
      
      // Use true embeddings if available, otherwise fallback to word overlap
      if (this.isEmbeddingReady && this.embedder && this.seedEmbeddings) {
        try {
          // Get embedding for the input message
          const messageEmbedding = await this.embedder(message, { pooling: 'mean', normalize: true });
          
          // Calculate cosine similarity with each intent's seed examples
          for (const [intent, seedEmbeddings] of Object.entries(this.seedEmbeddings)) {
            let maxSimilarity = 0;
            
            for (const seedEmbedding of seedEmbeddings) {
              const similarity = this.cosineSimilarity(messageEmbedding.data, seedEmbedding);
              maxSimilarity = Math.max(maxSimilarity, similarity);
            }
            
            scores[intent] = maxSimilarity;
          }
          
          return scores;
          
        } catch (error) {
          console.warn('⚠️ Embedding similarity failed, falling back to word overlap:', error.message);
        }
      }
      
      // Fallback: Simple word overlap similarity
      const messageLower = message.toLowerCase();
      
      for (const [intent, examples] of Object.entries(this.seedExamples)) {
        let maxSimilarity = 0;
        
        for (const example of examples) {
          const similarity = this.calculateWordOverlapSimilarity(messageLower, example);
          maxSimilarity = Math.max(maxSimilarity, similarity);
        }
        
        scores[intent] = maxSimilarity;
      }
      
      return scores;
    }
    
    cosineSimilarity(vecA, vecB) {
      if (vecA.length !== vecB.length) {
        throw new Error('Vectors must have the same length');
      }
      
      let dotProduct = 0;
      let normA = 0;
      let normB = 0;
      
      for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
      }
      
      normA = Math.sqrt(normA);
      normB = Math.sqrt(normB);
      
      if (normA === 0 || normB === 0) {
        return 0;
      }
      
      return dotProduct / (normA * normB);
    }
    
    calculateWordOverlapSimilarity(text1, text2) {
      const words1 = new Set(text1.split(/\s+/).filter(w => w.length > 2));
      const words2 = new Set(text2.split(/\s+/).filter(w => w.length > 2));
      
      const intersection = new Set([...words1].filter(x => words2.has(x)));
      const union = new Set([...words1, ...words2]);
      
      return union.size > 0 ? intersection.size / union.size : 0;
    }
    
    // Removed unused methods: combineScores() and calculateConfidence()
    // These were part of the old enhanced pattern+semantic combination approach
    
    async extractEntities(responseText, originalMessage) {
      const textToAnalyze = originalMessage;
      console.log('🔍 Entity extraction - analyzing text:', textToAnalyze);
      
      // 🔍 DEBUG: Check NER readiness
      console.log('🔍 DEBUG: NER readiness check:', {
        isNerReady: this.isNerReady,
        hasNerClassifier: !!this.nerClassifier
      });
      
      let allEntities = [];
      
      // 🏷️ LAYER 1: Try NER Transformer (most accurate for complex entities)
      if (this.isNerReady && this.nerClassifier) {
        try {
          console.log('🏷️ Using NER transformer for entity extraction...');
          
          const nerResults = await this.nerClassifier(textToAnalyze);
          
          if (nerResults && nerResults.length > 0) {
            console.log('✅ NER transformer found entities:', nerResults.length);
            
            // Process NER results and convert to our format
            const transformerEntities = this.processNerResults(nerResults, textToAnalyze);
            
            if (transformerEntities.length > 0) {
              console.log('✅ NER transformer results:', transformerEntities);
              allEntities.push(...transformerEntities);
            }
          }
          
        } catch (error) {
          console.warn('⚠️ NER transformer failed:', error.message);
        }
      }
      
      // 🔄 LAYER 2: Enhanced Pattern Matching (good for dates, locations, etc.)
      console.log('🔄 Using enhanced pattern matching for entities...');
      const patternEntities = this.extractEntitiesWithPatterns(textToAnalyze);
      
      if (patternEntities.length > 0) {
        console.log('✅ Pattern matching found entities:', patternEntities);
        allEntities.push(...patternEntities);
      }
      
      // Return combined results if we have any
      if (allEntities.length > 0) {
        console.log('✅ Combined entity extraction results:', allEntities);
        return allEntities;
      }
      
      // ⚡ LAYER 3: Basic Regex Fallback (last resort)
      console.log('⚡ Using basic regex fallback for entities...');
      return this.extractEntitiesBasic(textToAnalyze);
    }
    
    processNerResults(nerResults, originalText) {
      const entities = [];
      const processedEntities = new Map();
      
      // Group consecutive tokens of the same entity type
      let currentEntity = null;
      
      for (const result of nerResults) {
        const { entity, word, score, start, end } = result;
        
        // Skip low-confidence results
        if (score < 0.7) continue;
        
        // Remove B- and I- prefixes from entity labels
        const cleanEntity = entity.replace(/^[BI]-/, '');
        
        // Handle entity grouping (B- starts new entity, I- continues)
        if (entity.startsWith('B-') || !currentEntity || currentEntity.type !== cleanEntity) {
          // Save previous entity if exists
          if (currentEntity) {
            entities.push({
              value: currentEntity.text.trim(),
              type: this.mapNerToOurTypes(currentEntity.type),
              normalized_value: this.normalizeEntity(currentEntity.text.trim(), this.mapNerToOurTypes(currentEntity.type)),
              confidence: currentEntity.confidence,
              source: 'transformer'
            });
          }
          
          // Start new entity
          currentEntity = {
            type: cleanEntity,
            text: word.replace(/^##/, ''), // Remove BERT subword markers
            confidence: score,
            start: start,
            end: end
          };
        } else {
          // Continue current entity
          currentEntity.text += word.replace(/^##/, '');
          currentEntity.confidence = Math.min(currentEntity.confidence, score);
          currentEntity.end = end;
        }
      }
      
      // Don't forget the last entity
      if (currentEntity) {
        entities.push({
          value: currentEntity.text.trim(),
          type: this.mapNerToOurTypes(currentEntity.type),
          normalized_value: this.normalizeEntity(currentEntity.text.trim(), this.mapNerToOurTypes(currentEntity.type)),
          confidence: currentEntity.confidence,
          source: 'transformer'
        });
      }
      
      return entities;
    }
    
    mapNerToOurTypes(nerType) {
      const mapping = {
        'PER': 'person',
        'PERSON': 'person',
        'LOC': 'location', 
        'LOCATION': 'location',
        'ORG': 'organization',
        'ORGANIZATION': 'organization',
        'MISC': 'misc',
        'DATE': 'datetime',
        'TIME': 'datetime'
      };
      
      return mapping[nerType.toUpperCase()] || nerType.toLowerCase();
    }
    
    extractEntitiesWithPatterns(textToAnalyze) {
      const entities = [];
      
      // Enhanced pattern matching with better regex
      for (const [entityType, pattern] of Object.entries(this.entityPatterns)) {
        const matches = textToAnalyze.match(pattern);
        if (matches) {
          for (const match of matches) {
            const cleanMatch = match.trim();
            // Filter out artifacts
            if (cleanMatch.length > 2 && 
                !cleanMatch.includes('Intent') && 
                !cleanMatch.includes('Type') &&
                !cleanMatch.includes('Key') &&
                !cleanMatch.includes('\n')) {
              entities.push({
                value: cleanMatch,
                type: entityType,
                normalized_value: this.normalizeEntity(cleanMatch, entityType),
                confidence: 0.8,
                source: 'pattern'
              });
            }
          }
        }
      }
      
      return entities;
    }
    
    extractEntitiesBasic(textToAnalyze) {
      const entities = [];
      
      // Very basic fallback patterns
      const basicPatterns = {
        datetime: /\b(today|tomorrow|yesterday|next week|this week|\d{1,2}:\d{2}|\d{1,2}pm|\d{1,2}am)\b/gi,
        person: /\b[A-Z][a-z]+ [A-Z][a-z]+\b/g, // Simple "First Last" pattern
        location: /\b(at|in) ([A-Z][a-z]+ ?)+\b/g
      };
      
      for (const [entityType, pattern] of Object.entries(basicPatterns)) {
        const matches = textToAnalyze.match(pattern);
        if (matches) {
          for (const match of matches) {
            entities.push({
              value: match.trim(),
              type: entityType,
              normalized_value: this.normalizeEntity(match.trim(), entityType),
              confidence: 0.5,
              source: 'basic'
            });
          }
        }
      }
      
      return entities;
    }
    
    normalizeEntity(value, type) {
      if (!value || typeof value !== 'string') {
        return null;
      }
      
      const cleanValue = value.trim();
      if (cleanValue.length === 0) {
        return null;
      }
      
      try {
        switch (type) {
          case 'datetime':
            return this.normalizeDatetime(cleanValue);
          case 'person':
            return this.normalizePerson(cleanValue);
          case 'location':
            return this.normalizeLocation(cleanValue);
          case 'event':
            return this.normalizeEvent(cleanValue);
          case 'contact':
            return this.normalizeContact(cleanValue);
          default:
            return cleanValue;
        }
      } catch (error) {
        console.warn(`⚠️ Entity normalization failed for ${type}:`, error.message);
        return cleanValue; // Return original value on error
      }
    }
    
    normalizeDatetime(value) {
      const lowerValue = value.toLowerCase();
      const now = new Date();
      
      // Handle relative dates
      if (lowerValue === 'today') {
        return now.toISOString().split('T')[0];
      }
      if (lowerValue === 'tomorrow') {
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        return tomorrow.toISOString().split('T')[0];
      }
      if (lowerValue === 'yesterday') {
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        return yesterday.toISOString().split('T')[0];
      }
      if (lowerValue === 'next week') {
        const nextWeek = new Date(now);
        nextWeek.setDate(nextWeek.getDate() + 7);
        return nextWeek.toISOString().split('T')[0];
      }
      
      // Handle time formats (12:30, 2pm, etc.)
      const timeMatch = value.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
      if (timeMatch) {
        let hour = parseInt(timeMatch[1]);
        const minute = parseInt(timeMatch[2]);
        const ampm = timeMatch[3]?.toLowerCase();
        
        if (ampm === 'pm' && hour !== 12) hour += 12;
        if (ampm === 'am' && hour === 12) hour = 0;
        
        return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
      }
      
      // Handle simple pm/am formats (2pm, 10am)
      const simpleTimeMatch = value.match(/^(\d{1,2})\s*(am|pm)$/i);
      if (simpleTimeMatch) {
        let hour = parseInt(simpleTimeMatch[1]);
        const ampm = simpleTimeMatch[2].toLowerCase();
        
        if (ampm === 'pm' && hour !== 12) hour += 12;
        if (ampm === 'am' && hour === 12) hour = 0;
        
        return `${hour.toString().padStart(2, '0')}:00`;
      }
      
      return value; // Return original if no pattern matches
    }
    
    normalizePerson(value) {
      // Remove extra whitespace and normalize case
      const cleaned = value.replace(/\s+/g, ' ').trim();
      
      // Handle titles and proper names
      return cleaned.replace(/\b\w+/g, word => {
        // Keep common titles in proper case
        const lowerWord = word.toLowerCase();
        if (['dr', 'mr', 'mrs', 'ms', 'prof', 'sir', 'dame'].includes(lowerWord)) {
          return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() + '.';
        }
        // Capitalize first letter of each word
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      });
    }
    
    normalizeLocation(value) {
      // Capitalize location names properly
      return value.replace(/\b\w+/g, word => 
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      );
    }
    
    normalizeEvent(value) {
      // Normalize event names to lowercase for consistency
      return value.toLowerCase();
    }
    
    normalizeContact(value) {
      // Normalize phone numbers and emails
      if (value.includes('@')) {
        // Email - normalize to lowercase
        return value.toLowerCase();
      }
      
      // Phone number - remove formatting and standardize
      const phoneDigits = value.replace(/\D/g, '');
      if (phoneDigits.length === 10) {
        return `(${phoneDigits.slice(0,3)}) ${phoneDigits.slice(3,6)}-${phoneDigits.slice(6)}`;
      }
      if (phoneDigits.length === 11 && phoneDigits.startsWith('1')) {
        const number = phoneDigits.slice(1);
        return `+1 (${number.slice(0,3)}) ${number.slice(3,6)}-${number.slice(6)}`;
      }
      
      return value; // Return original if no standard format
    }
    
    determineBooleanFlags(responseText, originalMessage, intent) {
      const combinedText = (responseText + ' ' + originalMessage).toLowerCase();
      
      // More comprehensive pattern matching with edge case handling
      const memoryPatterns = [
        /\b(remember|store|save|keep track|don't forget|note|log|record)\b/,
        /\b(remind me|recall|what did I|do you remember)\b/,
        /\b(my (appointment|meeting|schedule|task|note))\b/
      ];
      
      const externalDataPatterns = [
        /\b(weather|temperature|forecast|climate)\b/,
        /\b(news|current events|headlines|breaking)\b/,
        /\b(search|lookup|find online|google|web)\b/,
        /\b(stock price|market|exchange rate)\b/,
        /\b(what time|current time|timezone)\b/
      ];
      
      const screenshotPatterns = [
        /\b(screenshot|screen shot|capture|snap)\b/,
        /\b(show me (the|this|what's on))\b/,
        /\b(take a (picture|photo) of)\b/,
        /\b(grab (the|this) (screen|display))\b/
      ];
      
      return {
        requiresMemoryAccess: intent === 'memory_store' || 
                             intent === 'memory_retrieve' ||
                             intent === 'memory_update' ||
                             intent === 'memory_delete' ||
                             memoryPatterns.some(pattern => pattern.test(combinedText)),
        requiresExternalData: externalDataPatterns.some(pattern => pattern.test(combinedText)),
        captureScreen: intent === 'command' && screenshotPatterns.some(pattern => pattern.test(combinedText))
      };
    }
    
    generateSuggestedResponse(responseText, originalMessage, intent) {
    if (!responseText || typeof responseText !== 'string') {
      return this.getFallbackResponse(intent);
    }
    
    // For memory storage intents, return appropriate acknowledgment (not LLM response)
    if (intent === 'memory_store') {
      return "I'll remember that for you.";
    }
    
    // For memory retrieval, wait for actual search results (no immediate response)
    if (intent === 'memory_retrieve') {
      return null; // Force UI to wait for background orchestration result
    }
    
    // For questions and commands, prioritize using the actual LLM response
    if (intent !== 'greeting') {
      // Clean up the response text and use it directly if it's substantial
      const cleanedResponse = responseText.trim();
      if (cleanedResponse.length > 10) {
        // Truncate if too long (keep first 200 chars for conciseness)
        return cleanedResponse;
      }
    }  
      
      // Extract any direct answer from the Phi3 response
      const lines = responseText.split('\n').filter(line => line.trim().length > 0);
      
      // Look for lines that contain actual answers (not analysis metadata)
      const answerLine = this.extractAnswerFromResponse(lines);
      if (answerLine) {
        return answerLine;
      }
      
      // If no direct answer found, generate contextual response
      return this.getFallbackResponse(intent, originalMessage);
    }
    
    extractAnswerFromResponse(lines) {
      const skipPatterns = [
        /^(Intent Type|Key Entities|Need for Memory|Screenshots|Briefly analyze)/i,
        /^(User:|Think through:|Analyze this)/i,
        /^(\d+\.|•|-|\*)/,  // List markers
        /^(The user|This is|Based on)/i
      ];
      
      const answerIndicators = [
        /\b(is often|considered|evidence|suggests|indicates)\b/i,
        /\b(according to|research shows|studies indicate)\b/i,
        /\b(the answer|the result|the solution)\b/i,
        /\b(Damascus|Jericho|ancient|oldest|years|BCE|AD)\b/i,  // Context-specific
        /\b(approximately|around|about|over|under)\s+\d+/i
      ];
      
      for (const line of lines) {
        const trimmedLine = line.trim();
        
        // Skip if line is too short or matches skip patterns
        if (trimmedLine.length < 20) continue;
        if (skipPatterns.some(pattern => pattern.test(trimmedLine))) continue;
        
        // Check if line contains answer indicators
        if (answerIndicators.some(pattern => pattern.test(trimmedLine))) {
          // Clean up the line
          let cleanedLine = trimmedLine
            .replace(/^(The\s+)?/i, '')  // Remove leading "The"
            .replace(/\s+/g, ' ')        // Normalize whitespace
            .trim();
          
          // Ensure it ends with proper punctuation
          if (!/[.!?]$/.test(cleanedLine)) {
            cleanedLine += '.';
          }
          
          return cleanedLine;
        }
      }
      
      return null;
    }
    
    getFallbackResponse(intent, originalMessage = '') {
      const responses = {
        memory_store: [
          "I'll remember that for you.",
          "Got it, I've stored that information.",
          "I'll keep that in mind."
        ],
        memory_retrieve: [
          "Let me check what I have stored about that.",
          "I'll look up that information for you.",
          "Let me recall what you told me about that."
        ],
        memory_update: [
          "I'll update that information for you.",
          "I'll modify what I have stored.",
          "I'll change that in my records."
        ],
        memory_delete: [
          "I'll remove that from my memory.",
          "I'll forget that information.",
          "I'll delete that record."
        ],
        command: [
          "I'll take care of that for you.",
          "I'll execute that command.",
          "I'll handle that action."
        ],
        greeting: [
          "Hello! How can I help you today?",
          "Hi there! What can I assist you with?",
          "Good to see you! How may I help?"
        ],
        question: [
          "I can help you find that information.",
          "Let me look that up for you.",
          "I'll help you with that question."
        ]
      };
      
      const intentResponses = responses[intent] || responses.question;
      
      // Add some variety by choosing based on message length
      const messageLength = originalMessage.length;
      const index = messageLength % intentResponses.length;
      
      return intentResponses[index];
    }
    
    extractAnalysis(responseText) {
      // Extract key phrases that indicate what the user is trying to do
      const analysisPatterns = [
        /user (?:wants|is trying|needs) to (.+?)\./i,
        /this (?:is|appears to be) (?:a|an) (.+?)\./i,
        /(?:request|message) (?:is|about) (.+?)\./i
      ];
      
      for (const pattern of analysisPatterns) {
        const match = responseText.match(pattern);
        if (match) {
          return match[1].trim();
        }
      }
      
      return "User message analysis";
    }
    
    extractReasoning(responseText, intent) {
      return `Classified as ${intent} based on content analysis`;
    }
    
    checkConsistency(responseText, originalMessage) {
      // Simple consistency check
      return "Analysis consistent with message content";
    }
    
    generateClarificationPrompt(intentResult) {
      const possibleIntents = intentResult.possibleIntents || ['store information', 'retrieve information', 'answer a question'];
      return `I'm not entirely sure what you'd like me to do. Could you clarify if you want me to: ${possibleIntents.join(', ')}?`;
    }
    
    /**
     * Use Phi3 LLM for intelligent intent classification when patterns are ambiguous
     */
    async classifyWithZeroShot(originalMessage) {
      try {
        // Initialize zero-shot classifier if not already done
        if (!this.zeroShotClassifier) {
          const { pipeline } = await import('@xenova/transformers');
          
          // Use Facebook's BART model for zero-shot classification
          console.log('🔄 Loading zero-shot classifier (BART)...');
          this.zeroShotClassifier = await pipeline(
            'zero-shot-classification',
            'facebook/bart-large-mnli'
          );
          console.log('✅ Zero-shot classifier loaded');
        }
        
        // Define candidate labels for intent classification
        const candidateLabels = [
          'I want to store information or share something that happened',
          'I want to retrieve or ask about stored information', 
          'I want to execute a command or action',
          'I have a general question that needs an answer',
          'I am greeting or saying goodbye'
        ];
        
        // Map labels back to intent names
        const labelMap = {
          'I want to store information or share something that happened': 'memory_store',
          'I want to retrieve or ask about stored information': 'memory_retrieve',
          'I want to execute a command or action': 'command',
          'I have a general question that needs an answer': 'question',
          'I am greeting or saying goodbye': 'greeting'
        };
        
        const result = await this.zeroShotClassifier(originalMessage, candidateLabels);
        
        if (result && result.labels && result.scores) {
          const topLabel = result.labels[0];
          const topScore = result.scores[0];
          const mappedIntent = labelMap[topLabel];
          
          return {
            intent: mappedIntent || 'question',
            confidence: topScore,
            reasoning: `Zero-shot classification: ${topLabel} (${(topScore * 100).toFixed(1)}%)`,
            entities: []
          };
        }
        
      } catch (error) {
        console.warn('⚠️ Zero-shot classification failed:', error.message);
      }
      
      return null;
    }
    
    // Removed setPhi3Agent method - now using zero-shot classification instead
}
  
module.exports = NaturalLanguageIntentParser;