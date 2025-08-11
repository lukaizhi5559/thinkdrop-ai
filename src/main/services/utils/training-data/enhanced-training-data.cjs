// Enhanced training data to address edge cases and real-world scenarios
// Focuses on quality over quantity with realistic, grammatically correct examples

function getEnhancedTrainingData() {
  return [
    // === CRITICAL MEMORY_RETRIEVE PATTERNS ===
    // These are high-priority examples to fix common misclassifications
    { text: "When was my last appt?", intent: "memory_retrieve", confidence: "high" },
    { text: "When was my last appointment?", intent: "memory_retrieve", confidence: "high" },
    { text: "When was my last appointment", intent: "memory_retrieve", confidence: "high" },
    { text: "When was my last doctor appointment?", intent: "memory_retrieve", confidence: "high" },
    { text: "When was my last meeting?", intent: "memory_retrieve", confidence: "high" },
    { text: "When was my last dentist appointment?", intent: "memory_retrieve", confidence: "high" },
    { text: "When did I last see the doctor?", intent: "memory_retrieve", confidence: "high" },
    { text: "When did I last go to the dentist?", intent: "memory_retrieve", confidence: "high" },
    { text: "What was my last appointment?", intent: "memory_retrieve", confidence: "high" },
    { text: "What was my last meeting about?", intent: "memory_retrieve", confidence: "high" },
    { text: "Where was my last appointment?", intent: "memory_retrieve", confidence: "high" },
    { text: "Who did I meet with last time?", intent: "memory_retrieve", confidence: "high" },
    { text: "What time was my last appointment?", intent: "memory_retrieve", confidence: "high" },
    { text: "How long was my last meeting?", intent: "memory_retrieve", confidence: "high" },
    { text: "What did the doctor say last time?", intent: "memory_retrieve", confidence: "high" },
    { text: "What happened at my last appointment?", intent: "memory_retrieve", confidence: "high" },
    { text: "When did I last visit the clinic?", intent: "memory_retrieve", confidence: "high" },
    { text: "When was my previous appointment?", intent: "memory_retrieve", confidence: "high" },
    { text: "What was discussed in my last meeting?", intent: "memory_retrieve", confidence: "high" },
    { text: "When did I last have a checkup?", intent: "memory_retrieve", confidence: "high" },
    
    // === CRITICAL "WHEN WAS THE LAST" PATTERNS ===
    { text: "when was the last website I visited", intent: "memory_retrieve", confidence: "high" },
    { text: "When was the last website I visited?", intent: "memory_retrieve", confidence: "high" },
    { text: "When was the last time I went to the gym?", intent: "memory_retrieve", confidence: "high" },
    { text: "When was the last time I called my mom?", intent: "memory_retrieve", confidence: "high" },
    { text: "When was the last time I ate pizza?", intent: "memory_retrieve", confidence: "high" },
    { text: "When was the last time I worked out?", intent: "memory_retrieve", confidence: "high" },
    { text: "When was the last time I went shopping?", intent: "memory_retrieve", confidence: "high" },
    { text: "When was the last time I watched a movie?", intent: "memory_retrieve", confidence: "high" },
    { text: "When was the last time I traveled?", intent: "memory_retrieve", confidence: "high" },
    { text: "When was the last time I cooked dinner?", intent: "memory_retrieve", confidence: "high" },
    { text: "When was the last time I read a book?", intent: "memory_retrieve", confidence: "high" },
    { text: "When was the last time I went to the store?", intent: "memory_retrieve", confidence: "high" },
    { text: "When was the last time I checked my email?", intent: "memory_retrieve", confidence: "high" },
    { text: "When was the last time I updated my resume?", intent: "memory_retrieve", confidence: "high" },
    { text: "When was the last time I backed up my files?", intent: "memory_retrieve", confidence: "high" },
    { text: "When was the last time I paid my bills?", intent: "memory_retrieve", confidence: "high" },
    { text: "When was the last time I cleaned my house?", intent: "memory_retrieve", confidence: "high" },
    
    // === CONTRASTING MEMORY_STORE EXAMPLES ===
    // These help distinguish between storing new info vs retrieving past info
    { text: "I just visited a new website", intent: "memory_store", confidence: "high" },
    { text: "I went to the gym this morning", intent: "memory_store", confidence: "high" },
    { text: "I called my mom earlier today", intent: "memory_store", confidence: "high" },
    { text: "I just ate pizza for lunch", intent: "memory_store", confidence: "high" },
    { text: "I worked out at the gym today", intent: "memory_store", confidence: "high" },
    { text: "I went shopping this afternoon", intent: "memory_store", confidence: "high" },
    { text: "I watched a great movie last night", intent: "memory_store", confidence: "high" },
    { text: "I just got back from traveling", intent: "memory_store", confidence: "high" },
    { text: "I cooked dinner for my family tonight", intent: "memory_store", confidence: "high" },
    { text: "I finished reading an amazing book", intent: "memory_store", confidence: "high" },
    // === EDGE CASE QUESTIONS ===
    // Factual questions that might be misclassified
    { text: "Who is the president of the United States", intent: "question", confidence: "high" },
    { text: "Who is the current president of South Africa", intent: "question", confidence: "high" },
    { text: "Who is the prime minister of Canada", intent: "question", confidence: "high" },
    { text: "Who is the CEO of Microsoft", intent: "question", confidence: "high" },
    { text: "Who is the founder of Tesla", intent: "question", confidence: "high" },
    { text: "Who invented the internet", intent: "question", confidence: "high" },
    { text: "Who wrote Romeo and Juliet", intent: "question", confidence: "high" },
    { text: "Who discovered gravity", intent: "question", confidence: "high" },
    { text: "Who painted the Mona Lisa", intent: "question", confidence: "high" },
    { text: "Who is the richest person in the world", intent: "question", confidence: "high" },
    
    // What questions - factual
    { text: "What is the capital of Japan", intent: "question", confidence: "high" },
    { text: "What is the largest country in the world", intent: "question", confidence: "high" },
    { text: "What is the speed of light", intent: "question", confidence: "high" },
    { text: "What is the population of India", intent: "question", confidence: "high" },
    { text: "What is artificial intelligence", intent: "question", confidence: "high" },
    { text: "What is quantum computing", intent: "question", confidence: "high" },
    { text: "What is the meaning of life", intent: "question", confidence: "high" },
    { text: "What is the tallest mountain", intent: "question", confidence: "high" },
    { text: "What is the deepest ocean", intent: "question", confidence: "high" },
    { text: "What is the oldest civilization", intent: "question", confidence: "high" },
    
    // How questions - procedural
    { text: "How do I cook pasta", intent: "question", confidence: "high" },
    { text: "How do I change a tire", intent: "question", confidence: "high" },
    { text: "How do I learn Python", intent: "question", confidence: "high" },
    { text: "How do I start a business", intent: "question", confidence: "high" },
    { text: "How do I lose weight", intent: "question", confidence: "high" },
    { text: "How do I meditate", intent: "question", confidence: "high" },
    { text: "How do I invest in stocks", intent: "question", confidence: "high" },
    { text: "How do I write a resume", intent: "question", confidence: "high" },
    { text: "How do I fix a leaky faucet", intent: "question", confidence: "high" },
    { text: "How do I bake a cake", intent: "question", confidence: "high" },
    
    // When questions - temporal
    { text: "When was World War 2", intent: "question", confidence: "high" },
    { text: "When did the internet start", intent: "question", confidence: "high" },
    { text: "When is the next solar eclipse", intent: "question", confidence: "high" },
    { text: "When was the first computer invented", intent: "question", confidence: "high" },
    { text: "When did humans land on the moon", intent: "question", confidence: "high" },
    { text: "When was Shakespeare born", intent: "question", confidence: "high" },
    { text: "When did the dinosaurs go extinct", intent: "question", confidence: "high" },
    { text: "When was the iPhone released", intent: "question", confidence: "high" },
    { text: "When did the Berlin Wall fall", intent: "question", confidence: "high" },
    { text: "When was the United Nations founded", intent: "question", confidence: "high" },
    
    // Where questions - location
    { text: "Where is the Eiffel Tower", intent: "question", confidence: "high" },
    { text: "Where is Mount Everest", intent: "question", confidence: "high" },
    { text: "Where is the Great Wall of China", intent: "question", confidence: "high" },
    { text: "Where is the Statue of Liberty", intent: "question", confidence: "high" },
    { text: "Where is Silicon Valley", intent: "question", confidence: "high" },
    { text: "Where is the Amazon rainforest", intent: "question", confidence: "high" },
    { text: "Where is the Sahara desert", intent: "question", confidence: "high" },
    { text: "Where is the North Pole", intent: "question", confidence: "high" },
    { text: "Where is the equator", intent: "question", confidence: "high" },
    { text: "Where is the International Space Station", intent: "question", confidence: "high" },
    
    // Why questions - explanatory
    { text: "Why is the sky blue", intent: "question", confidence: "high" },
    { text: "Why do we dream", intent: "question", confidence: "high" },
    { text: "Why do birds migrate", intent: "question", confidence: "high" },
    { text: "Why is water wet", intent: "question", confidence: "high" },
    { text: "Why do we age", intent: "question", confidence: "high" },
    { text: "Why do we sleep", intent: "question", confidence: "high" },
    { text: "Why is the ocean salty", intent: "question", confidence: "high" },
    { text: "Why do leaves change color", intent: "question", confidence: "high" },
    { text: "Why do we have seasons", intent: "question", confidence: "high" },
    { text: "Why do we yawn", intent: "question", confidence: "high" },
    
    // === EDGE CASE MEMORY_STORE ===
    // Future events (often misclassified as memory_retrieve)
    { text: "I have a doctor appointment next week", intent: "memory_store", confidence: "high" },
    { text: "My vacation starts next month", intent: "memory_store", confidence: "high" },
    { text: "I'm getting married in June", intent: "memory_store", confidence: "high" },
    { text: "My kids start school on Monday", intent: "memory_store", confidence: "high" },
    { text: "I have a job interview tomorrow", intent: "memory_store", confidence: "high" },
    { text: "My birthday is next week", intent: "memory_store", confidence: "high" },
    { text: "I'm moving to a new house next month", intent: "memory_store", confidence: "high" },
    { text: "I have a conference call at 3pm", intent: "memory_store", confidence: "high" },
    { text: "My dentist appointment is on Friday", intent: "memory_store", confidence: "high" },
    { text: "I'm traveling to Paris next year", intent: "memory_store", confidence: "high" },
    
    // Past events with specific details
    { text: "I went to the gym yesterday morning", intent: "memory_store", confidence: "high" },
    { text: "I had lunch with my boss last Tuesday", intent: "memory_store", confidence: "high" },
    { text: "I finished reading that book last night", intent: "memory_store", confidence: "high" },
    { text: "I called my mom on Sunday", intent: "memory_store", confidence: "high" },
    { text: "I bought groceries after work", intent: "memory_store", confidence: "high" },
    { text: "I watched a movie with friends yesterday", intent: "memory_store", confidence: "high" },
    { text: "I completed my project on time", intent: "memory_store", confidence: "high" },
    { text: "I attended a wedding last weekend", intent: "memory_store", confidence: "high" },
    { text: "I learned how to cook pasta", intent: "memory_store", confidence: "high" },
    { text: "I started a new exercise routine", intent: "memory_store", confidence: "high" },
    
    // === EDGE CASE MEMORY_RETRIEVE ===
    // Temporal queries that might be misclassified
    { text: "What do I have scheduled for tomorrow", intent: "memory_retrieve", confidence: "high" },
    { text: "What's happening next week", intent: "memory_retrieve", confidence: "high" },
    { text: "Do I have any appointments today", intent: "memory_retrieve", confidence: "high" },
    { text: "What did I do last weekend", intent: "memory_retrieve", confidence: "high" },
    { text: "When is my next meeting", intent: "memory_retrieve", confidence: "high" },
    { text: "What's on my calendar for Friday", intent: "memory_retrieve", confidence: "high" },
    { text: "Do I have anything planned this evening", intent: "memory_retrieve", confidence: "high" },
    { text: "What did we discuss in our last conversation", intent: "memory_retrieve", confidence: "high" },
    { text: "Remind me what I said about the project", intent: "memory_retrieve", confidence: "high" },
    { text: "What was I working on yesterday", intent: "memory_retrieve", confidence: "high" },
    
    // === EDGE CASE COMMANDS ===
    // Modern tech commands
    { text: "Take a screenshot", intent: "command", confidence: "high" },
    { text: "Open my email", intent: "command", confidence: "high" },
    { text: "Start screen recording", intent: "command", confidence: "high" },
    { text: "Launch the calculator", intent: "command", confidence: "high" },
    { text: "Open the browser", intent: "command", confidence: "high" },
    { text: "Close all windows", intent: "command", confidence: "high" },
    { text: "Save this document", intent: "command", confidence: "high" },
    { text: "Print this page", intent: "command", confidence: "high" },
    { text: "Copy this text", intent: "command", confidence: "high" },
    { text: "Paste the clipboard", intent: "command", confidence: "high" },
    
    // System commands
    { text: "Restart the computer", intent: "command", confidence: "high" },
    { text: "Check the system status", intent: "command", confidence: "high" },
    { text: "Update the software", intent: "command", confidence: "high" },
    { text: "Run a virus scan", intent: "command", confidence: "high" },
    { text: "Clear the cache", intent: "command", confidence: "high" },
    { text: "Backup my files", intent: "command", confidence: "high" },
    { text: "Connect to WiFi", intent: "command", confidence: "high" },
    { text: "Turn on airplane mode", intent: "command", confidence: "high" },
    { text: "Adjust the volume", intent: "command", confidence: "high" },
    { text: "Change the wallpaper", intent: "command", confidence: "high" },
    
    // === EDGE CASE GREETINGS ===
    // Modern/casual greetings
    { text: "Hey there", intent: "greeting", confidence: "high" },
    { text: "What's up", intent: "greeting", confidence: "high" },
    { text: "How's it going", intent: "greeting", confidence: "high" },
    { text: "Good to see you", intent: "greeting", confidence: "high" },
    { text: "How are you doing", intent: "greeting", confidence: "high" },
    { text: "Nice to meet you", intent: "greeting", confidence: "high" },
    { text: "How have you been", intent: "greeting", confidence: "high" },
    { text: "Long time no see", intent: "greeting", confidence: "high" },
    { text: "Hope you're well", intent: "greeting", confidence: "high" },
    { text: "Good to hear from you", intent: "greeting", confidence: "high" },
    
    // Farewell greetings
    { text: "See you later", intent: "greeting", confidence: "high" },
    { text: "Take care", intent: "greeting", confidence: "high" },
    { text: "Have a great day", intent: "greeting", confidence: "high" },
    { text: "Talk to you soon", intent: "greeting", confidence: "high" },
    { text: "Catch you later", intent: "greeting", confidence: "high" },
    { text: "Until next time", intent: "greeting", confidence: "high" },
    { text: "Have a good one", intent: "greeting", confidence: "high" },
    { text: "Peace out", intent: "greeting", confidence: "high" },
    { text: "Goodbye for now", intent: "greeting", confidence: "high" },
    { text: "See you around", intent: "greeting", confidence: "high" },
    
    // === AMBIGUOUS CASES (POTENTIAL MISCLASSIFICATIONS) ===
    // Questions that might be confused with memory_retrieve
    { text: "What time is it", intent: "question", confidence: "high" },
    { text: "What's the weather like", intent: "question", confidence: "high" },
    { text: "How much does this cost", intent: "question", confidence: "high" },
    { text: "Where can I buy this", intent: "question", confidence: "high" },
    { text: "How long will this take", intent: "question", confidence: "high" },
    { text: "What's the best way to do this", intent: "question", confidence: "high" },
    { text: "How far is it to the airport", intent: "question", confidence: "high" },
    { text: "What's the exchange rate", intent: "question", confidence: "high" },
    { text: "How many calories are in this", intent: "question", confidence: "high" },
    { text: "What's the speed limit here", intent: "question", confidence: "high" },
    
    // Commands that might be confused with questions
    { text: "Show me the weather", intent: "command", confidence: "high" },
    { text: "Display my calendar", intent: "command", confidence: "high" },
    { text: "Find nearby restaurants", intent: "command", confidence: "high" },
    { text: "Search for flights", intent: "command", confidence: "high" },
    { text: "Play some music", intent: "command", confidence: "high" },
    { text: "Set a timer for 10 minutes", intent: "command", confidence: "high" },
    { text: "Send a message to John", intent: "command", confidence: "high" },
    { text: "Call my mom", intent: "command", confidence: "high" },
    { text: "Navigate to the store", intent: "command", confidence: "high" },
    { text: "Book a table for two", intent: "command", confidence: "high" },
    
    // Memory store that might be confused with questions
    { text: "I learned that Python is a programming language", intent: "memory_store", confidence: "high" },
    { text: "I discovered that coffee helps me focus", intent: "memory_store", confidence: "high" },
    { text: "I found out that my neighbor is moving", intent: "memory_store", confidence: "high" },
    { text: "I realized that I need to exercise more", intent: "memory_store", confidence: "high" },
    { text: "I noticed that my car needs an oil change", intent: "memory_store", confidence: "high" },
    { text: "I figured out how to fix the printer", intent: "memory_store", confidence: "high" },
    { text: "I remembered that I have a dentist appointment", intent: "memory_store", confidence: "high" },
    { text: "I decided to start learning Spanish", intent: "memory_store", confidence: "high" },
    { text: "I concluded that I should save more money", intent: "memory_store", confidence: "high" },
    { text: "I understood why the project was delayed", intent: "memory_store", confidence: "high" },
    
    // === CONVERSATIONAL EDGE CASES ===
    // Incomplete or fragmented inputs
    { text: "Tell me about", intent: "question", confidence: "medium" },
    { text: "How do I", intent: "question", confidence: "medium" },
    { text: "What about", intent: "question", confidence: "medium" },
    { text: "I want to know", intent: "question", confidence: "medium" },
    { text: "Can you explain", intent: "question", confidence: "medium" },
    { text: "I'm curious about", intent: "question", confidence: "medium" },
    { text: "Help me understand", intent: "question", confidence: "medium" },
    { text: "I don't get", intent: "question", confidence: "medium" },
    { text: "What's the deal with", intent: "question", confidence: "medium" },
    { text: "I'm wondering", intent: "question", confidence: "medium" },
    
    // Polite variations
    { text: "Could you please tell me who the president is", intent: "question", confidence: "high" },
    { text: "Would you mind explaining how this works", intent: "question", confidence: "high" },
    { text: "I'd like to know what time it is", intent: "question", confidence: "high" },
    { text: "Can you help me understand this concept", intent: "question", confidence: "high" },
    { text: "I was wondering if you could tell me", intent: "question", confidence: "high" },
    { text: "Do you happen to know who invented this", intent: "question", confidence: "high" },
    { text: "I'm curious to learn about artificial intelligence", intent: "question", confidence: "high" },
    { text: "Would it be possible to explain quantum physics", intent: "question", confidence: "high" },
    { text: "Could you please show me how to do this", intent: "command", confidence: "high" },
    { text: "I'd appreciate it if you could help me", intent: "question", confidence: "high" }
  ];
}

module.exports = getEnhancedTrainingData;
