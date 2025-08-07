// Edge case training data to address specific misclassification scenarios
// Based on analysis of common intent classification failures

function getEdgeCaseTrainingData() {
  return [
    // === CRITICAL EDGE CASES ===
    
    // 1. TEMPORAL CONFUSION: Future events that might be classified as memory_retrieve instead of memory_store
    { text: "I have a meeting coming up next Tuesday", intent: "memory_store", confidence: "high" },
    { text: "My vacation starts in two weeks", intent: "memory_store", confidence: "high" },
    { text: "I'm getting a haircut tomorrow", intent: "memory_store", confidence: "high" },
    { text: "My dentist appointment is scheduled for Friday", intent: "memory_store", confidence: "high" },
    { text: "I have a conference call at 3pm today", intent: "memory_store", confidence: "high" },
    { text: "My flight leaves at 6am tomorrow", intent: "memory_store", confidence: "high" },
    { text: "I'm starting a new job next month", intent: "memory_store", confidence: "high" },
    { text: "My kids have soccer practice on Saturday", intent: "memory_store", confidence: "high" },
    { text: "I have a doctor's appointment next week", intent: "memory_store", confidence: "high" },
    { text: "My anniversary is coming up next month", intent: "memory_store", confidence: "high" },
    
    // 2. QUESTION vs MEMORY_RETRIEVE confusion
    { text: "What is the capital of Germany", intent: "question", confidence: "high" },
    { text: "How do you make coffee", intent: "question", confidence: "high" },
    { text: "When was the Declaration of Independence signed", intent: "question", confidence: "high" },
    { text: "Where is the Louvre Museum", intent: "question", confidence: "high" },
    { text: "Why do cats purr", intent: "question", confidence: "high" },
    { text: "How many continents are there", intent: "question", confidence: "high" },
    { text: "What is the largest ocean", intent: "question", confidence: "high" },
    { text: "Who wrote the Constitution", intent: "question", confidence: "high" },
    { text: "When did the Cold War end", intent: "question", confidence: "high" },
    { text: "How does the internet work", intent: "question", confidence: "high" },
    
    // 3. MEMORY_RETRIEVE with clear temporal indicators
    { text: "What do I have scheduled for tomorrow", intent: "memory_retrieve", confidence: "high" },
    { text: "Do I have any meetings today", intent: "memory_retrieve", confidence: "high" },
    { text: "What's on my calendar this week", intent: "memory_retrieve", confidence: "high" },
    { text: "When is my next appointment", intent: "memory_retrieve", confidence: "high" },
    { text: "What did I do yesterday", intent: "memory_retrieve", confidence: "high" },
    { text: "Do I have anything planned for the weekend", intent: "memory_retrieve", confidence: "high" },
    { text: "What's happening next week", intent: "memory_retrieve", confidence: "high" },
    { text: "Show me my schedule for Friday", intent: "memory_retrieve", confidence: "high" },
    { text: "What did we discuss last time", intent: "memory_retrieve", confidence: "high" },
    { text: "Remind me what I said about the project", intent: "memory_retrieve", confidence: "high" },
    
    // 4. COMMAND vs QUESTION confusion (imperative vs interrogative)
    { text: "Show me the weather forecast", intent: "command", confidence: "high" },
    { text: "Open my calendar", intent: "command", confidence: "high" },
    { text: "Find restaurants near me", intent: "command", confidence: "high" },
    { text: "Play my favorite playlist", intent: "command", confidence: "high" },
    { text: "Set an alarm for 7am", intent: "command", confidence: "high" },
    { text: "Send a text to Sarah", intent: "command", confidence: "high" },
    { text: "Book a flight to New York", intent: "command", confidence: "high" },
    { text: "Order pizza for dinner", intent: "command", confidence: "high" },
    { text: "Turn on the lights", intent: "command", confidence: "high" },
    { text: "Start a video call with John", intent: "command", confidence: "high" },
    
    // 5. POLITE QUESTIONS that might be misclassified
    { text: "Could you tell me what time it is", intent: "question", confidence: "high" },
    { text: "Would you mind explaining how this works", intent: "question", confidence: "high" },
    { text: "Can you help me understand quantum physics", intent: "question", confidence: "high" },
    { text: "I'd like to know who invented the telephone", intent: "question", confidence: "high" },
    { text: "Do you happen to know the population of Tokyo", intent: "question", confidence: "high" },
    { text: "I was wondering what the weather is like", intent: "question", confidence: "high" },
    { text: "Could you please explain artificial intelligence", intent: "question", confidence: "high" },
    { text: "Would it be possible to tell me about Mars", intent: "question", confidence: "high" },
    { text: "I'm curious about how photosynthesis works", intent: "question", confidence: "high" },
    { text: "Can you clarify what blockchain technology is", intent: "question", confidence: "high" },
    
    // 6. GREETING variations that might be confused with questions
    { text: "How's your day going", intent: "greeting", confidence: "high" },
    { text: "What's new with you", intent: "greeting", confidence: "high" },
    { text: "How have you been", intent: "greeting", confidence: "high" },
    { text: "What's happening", intent: "greeting", confidence: "high" },
    { text: "How are things", intent: "greeting", confidence: "high" },
    { text: "What's good", intent: "greeting", confidence: "high" },
    { text: "How's life treating you", intent: "greeting", confidence: "high" },
    { text: "What's the word", intent: "greeting", confidence: "high" },
    { text: "How goes it", intent: "greeting", confidence: "high" },
    { text: "What's cooking", intent: "greeting", confidence: "high" },
    
    // 7. MEMORY_STORE with discovery/learning patterns
    { text: "I just learned that coffee originated in Ethiopia", intent: "memory_store", confidence: "high" },
    { text: "I discovered that my neighbor is a doctor", intent: "memory_store", confidence: "high" },
    { text: "I found out that the meeting was cancelled", intent: "memory_store", confidence: "high" },
    { text: "I realized that I need to update my resume", intent: "memory_store", confidence: "high" },
    { text: "I figured out how to fix the printer issue", intent: "memory_store", confidence: "high" },
    { text: "I noticed that my car makes a strange noise", intent: "memory_store", confidence: "high" },
    { text: "I understood why the project was delayed", intent: "memory_store", confidence: "high" },
    { text: "I concluded that we need more team members", intent: "memory_store", confidence: "high" },
    { text: "I determined that the best route is via highway", intent: "memory_store", confidence: "high" },
    { text: "I observed that productivity increases after lunch", intent: "memory_store", confidence: "high" },
    
    // 8. COMPLEX QUESTIONS with multiple clauses
    { text: "What is the difference between machine learning and artificial intelligence", intent: "question", confidence: "high" },
    { text: "How do you calculate the area of a circle and what is pi", intent: "question", confidence: "high" },
    { text: "When was the first computer invented and who created it", intent: "question", confidence: "high" },
    { text: "Where is the headquarters of Google and how many employees do they have", intent: "question", confidence: "high" },
    { text: "Why do we have leap years and how often do they occur", intent: "question", confidence: "high" },
    { text: "What is the fastest animal on earth and how fast can it run", intent: "question", confidence: "high" },
    { text: "How does solar energy work and what are its benefits", intent: "question", confidence: "high" },
    { text: "When did World War 2 start and end and which countries were involved", intent: "question", confidence: "high" },
    { text: "What is cryptocurrency and how does Bitcoin mining work", intent: "question", confidence: "high" },
    { text: "Where is the International Space Station and how long does it take to orbit Earth", intent: "question", confidence: "high" },
    
    // 9. AMBIGUOUS CASES with context clues
    { text: "I might have something planned for next week", intent: "memory_store", confidence: "medium" },
    { text: "I think I told you about my vacation plans", intent: "memory_retrieve", confidence: "medium" },
    { text: "Maybe you could help me with this problem", intent: "question", confidence: "medium" },
    { text: "Perhaps we should schedule a meeting", intent: "memory_store", confidence: "medium" },
    { text: "I believe I have an appointment somewhere", intent: "memory_retrieve", confidence: "medium" },
    { text: "Possibly you know the answer to this", intent: "question", confidence: "medium" },
    { text: "I suppose I should remember this information", intent: "memory_store", confidence: "medium" },
    { text: "Maybe you can show me how to do this", intent: "command", confidence: "medium" },
    { text: "I guess I should check my calendar", intent: "memory_retrieve", confidence: "medium" },
    { text: "Perhaps you could explain this concept", intent: "question", confidence: "medium" },
    
    // 10. CONVERSATIONAL FRAGMENTS that need classification
    { text: "Tell me more about", intent: "question", confidence: "medium" },
    { text: "I want to know", intent: "question", confidence: "medium" },
    { text: "Can you explain", intent: "question", confidence: "medium" },
    { text: "Help me understand", intent: "question", confidence: "medium" },
    { text: "I'm curious about", intent: "question", confidence: "medium" },
    { text: "Let me know", intent: "question", confidence: "medium" },
    { text: "Show me how", intent: "command", confidence: "medium" },
    { text: "I need to remember", intent: "memory_store", confidence: "medium" },
    { text: "Don't forget that", intent: "memory_store", confidence: "medium" },
    { text: "Remind me about", intent: "memory_retrieve", confidence: "medium" },
    
    // 11. TECHNICAL QUESTIONS that might be misclassified
    { text: "How do I install Python on Windows", intent: "question", confidence: "high" },
    { text: "What is the difference between HTTP and HTTPS", intent: "question", confidence: "high" },
    { text: "How do you create a database in MySQL", intent: "question", confidence: "high" },
    { text: "What is the purpose of a firewall", intent: "question", confidence: "high" },
    { text: "How do you debug JavaScript code", intent: "question", confidence: "high" },
    { text: "What is the difference between RAM and storage", intent: "question", confidence: "high" },
    { text: "How do you backup your computer files", intent: "question", confidence: "high" },
    { text: "What is cloud computing and how does it work", intent: "question", confidence: "high" },
    { text: "How do you secure a WiFi network", intent: "question", confidence: "high" },
    { text: "What is the difference between 4G and 5G", intent: "question", confidence: "high" },
    
    // 12. PERSONAL QUESTIONS vs FACTUAL QUESTIONS
    { text: "What is my favorite color", intent: "memory_retrieve", confidence: "high" },
    { text: "When did I last go to the gym", intent: "memory_retrieve", confidence: "high" },
    { text: "What did I have for breakfast", intent: "memory_retrieve", confidence: "high" },
    { text: "Where did I put my keys", intent: "memory_retrieve", confidence: "high" },
    { text: "What is the color red", intent: "question", confidence: "high" },
    { text: "When was the last Olympics", intent: "question", confidence: "high" },
    { text: "What is a typical breakfast", intent: "question", confidence: "high" },
    { text: "Where are car keys usually kept", intent: "question", confidence: "high" },
    { text: "How do I remember where I put things", intent: "question", confidence: "high" },
    { text: "What helps with memory retention", intent: "question", confidence: "high" }
  ];
}

module.exports = getEdgeCaseTrainingData;
