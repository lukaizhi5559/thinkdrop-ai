#!/usr/bin/env swift

import Foundation
import Cocoa
import Carbon.HIToolbox

struct KeyEvent: Codable {
    let type: String
    let key: String?
    let keyCode: Int?
    let modifiers: [String]
    let timestamp: Double
}

struct Command: Codable {
    let command: String
    let data: [String: String]?
}

struct Response: Codable {
    let type: String
    let data: [String: AnyCodable]?
    let error: String?
}

struct AnyCodable: Codable {
    let value: Any
    
    init(_ value: Any) {
        self.value = value
    }
    
    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let bool = try? container.decode(Bool.self) {
            value = bool
        } else if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let string = try? container.decode(String.self) {
            value = string
        } else {
            value = ""
        }
    }
    
    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        if let bool = value as? Bool {
            try container.encode(bool)
        } else if let int = value as? Int {
            try container.encode(int)
        } else if let double = value as? Double {
            try container.encode(double)
        } else if let string = value as? String {
            try container.encode(string)
        }
    }
}

class KeyHookManager {
    private var eventTap: CFMachPort?
    private var runLoopSource: CFRunLoopSource?
    private var isCaptureActive = false
    private let stdinQueue = DispatchQueue(label: "stdin.reader")
    
    func start() {
        checkAccessibilityPermissions()
        setupStdinListener()
        sendStatus(message: "KeyHook helper started", ready: true)
        RunLoop.main.run()
    }
    
    private func checkAccessibilityPermissions() -> Bool {
        let options: NSDictionary = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true]
        let accessEnabled = AXIsProcessTrustedWithOptions(options)
        
        if !accessEnabled {
            sendError(message: "Accessibility permissions required. Please grant access in System Preferences > Security & Privacy > Privacy > Accessibility")
            return false
        }
        return true
    }
    
    private func setupStdinListener() {
        stdinQueue.async { [weak self] in
            while let line = readLine() {
                self?.handleCommand(line)
            }
            self?.shutdown()
        }
    }
    
    private func handleCommand(_ line: String) {
        guard let data = line.data(using: .utf8),
              let command = try? JSONDecoder().decode(Command.self, from: data) else {
            sendError(message: "Invalid command JSON")
            return
        }
        
        switch command.command {
        case "startCapture":
            startCapture()
        case "stopCapture":
            stopCapture()
        case "ping":
            sendResponse(type: "pong", data: nil)
        case "shutdown":
            shutdown()
        default:
            sendError(message: "Unknown command: \(command.command)")
        }
    }
    
    private func startCapture() {
        guard !isCaptureActive else {
            sendResponse(type: "captureAlreadyActive", data: nil)
            return
        }
        
        guard checkAccessibilityPermissions() else {
            sendError(message: "Accessibility permissions not granted")
            return
        }
        
        let eventMask = (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.keyUp.rawValue) | (1 << CGEventType.flagsChanged.rawValue)
        
        sendStatus(message: "Creating event tap with mask: \(eventMask)", ready: true)
        
        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .defaultTap,
            eventsOfInterest: CGEventMask(eventMask),
            callback: { (proxy, type, event, refcon) -> Unmanaged<CGEvent>? in
                let manager = Unmanaged<KeyHookManager>.fromOpaque(refcon!).takeUnretainedValue()
                return manager.handleEvent(proxy: proxy, type: type, event: event)
            },
            userInfo: Unmanaged.passUnretained(self).toOpaque()
        ) else {
            sendError(message: "Failed to create event tap - check Accessibility permissions")
            return
        }
        
        eventTap = tap
        runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), runLoopSource, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        
        isCaptureActive = true
        sendStatus(message: "Event tap created and enabled", ready: true)
        sendResponse(type: "captureStarted", data: nil)
    }
    
    private func stopCapture() {
        guard isCaptureActive else {
            return
        }
        
        if let tap = eventTap {
            CGEvent.tapEnable(tap: tap, enable: false)
            CFRunLoopRemoveSource(CFRunLoopGetMain(), runLoopSource, .commonModes)
            eventTap = nil
            runLoopSource = nil
        }
        
        isCaptureActive = false
        sendResponse(type: "captureStopped", data: nil)
    }
    
    private func handleEvent(proxy: CGEventTapProxy, type: CGEventType, event: CGEvent) -> Unmanaged<CGEvent>? {
        guard isCaptureActive else {
            return Unmanaged.passRetained(event)
        }
        
        if type == .keyDown {
            let keyCode = Int(event.getIntegerValueField(.keyboardEventKeycode))
            let flags = event.flags
            
            let modifiers = extractModifiers(from: flags)
            let key = keyCodeToString(keyCode: keyCode, flags: flags)
            
            sendStatus(message: "Key event: \(key ?? "nil") code=\(keyCode) mods=\(modifiers)", ready: true)
            
            let shouldSwallow = shouldSwallowKey(keyCode: keyCode, modifiers: modifiers)
            
            if shouldSwallow {
                let keyEvent = KeyEvent(
                    type: "keyDown",
                    key: key,
                    keyCode: keyCode,
                    modifiers: modifiers,
                    timestamp: Date().timeIntervalSince1970
                )
                sendKeyEvent(keyEvent)
                return nil
            } else {
                return Unmanaged.passRetained(event)
            }
        }
        
        return Unmanaged.passRetained(event)
    }
    
    private func shouldSwallowKey(keyCode: Int, modifiers: [String]) -> Bool {
        // Allow Cmd+Shift+L to pass through (toggle prompt capture)
        if modifiers.contains("cmd") && modifiers.contains("shift") && keyCode == 37 {
            return false
        }
        
        // Capture Cmd+A for select all in prompt capture
        if modifiers.contains("cmd") && keyCode == 0 { // 'a' key
            return true
        }
        
        // Capture arrow keys with Shift for text selection
        if modifiers.contains("shift") && (keyCode == 123 || keyCode == 124) { // left/right arrows
            return true
        }
        
        // Capture plain arrow keys for cursor movement
        if keyCode == 123 || keyCode == 124 || keyCode == 125 || keyCode == 126 { // all arrows
            return true
        }
        
        // Don't capture other Cmd/Ctrl shortcuts
        if modifiers.contains("cmd") || modifiers.contains("ctrl") {
            return false
        }
        
        return true
    }
    
    private func extractModifiers(from flags: CGEventFlags) -> [String] {
        var modifiers: [String] = []
        if flags.contains(.maskShift) { modifiers.append("shift") }
        if flags.contains(.maskControl) { modifiers.append("ctrl") }
        if flags.contains(.maskAlternate) { modifiers.append("alt") }
        if flags.contains(.maskCommand) { modifiers.append("cmd") }
        return modifiers
    }
    
    private func keyCodeToString(keyCode: Int, flags: CGEventFlags) -> String? {
        let isShiftPressed = flags.contains(.maskShift)
        
        let keyMap: [Int: (normal: String, shifted: String)] = [
            0: ("a", "A"), 1: ("s", "S"), 2: ("d", "D"), 3: ("f", "F"),
            4: ("h", "H"), 5: ("g", "G"), 6: ("z", "Z"), 7: ("x", "X"),
            8: ("c", "C"), 9: ("v", "V"), 11: ("b", "B"), 12: ("q", "Q"),
            13: ("w", "W"), 14: ("e", "E"), 15: ("r", "R"), 16: ("y", "Y"),
            17: ("t", "T"), 18: ("1", "!"), 19: ("2", "@"), 20: ("3", "#"),
            21: ("4", "$"), 22: ("6", "^"), 23: ("5", "%"), 24: ("=", "+"),
            25: ("9", "("), 26: ("7", "&"), 27: ("-", "_"), 28: ("8", "*"),
            29: ("0", ")"), 30: ("]", "}"), 31: ("o", "O"), 32: ("u", "U"),
            33: ("[", "{"), 34: ("i", "I"), 35: ("p", "P"), 37: ("l", "L"),
            38: ("j", "J"), 39: ("'", "\""), 40: ("k", "K"), 41: (";", ":"),
            42: ("\\", "|"), 43: (",", "<"), 44: ("/", "?"), 45: ("n", "N"),
            46: ("m", "M"), 47: (".", ">"), 50: ("`", "~"),
            49: (" ", " "),
            36: ("\n", "\n"),
            51: ("\u{08}", "\u{08}"),
            53: ("\u{1B}", "\u{1B}"),
            48: ("\t", "\t"),
            // Arrow keys
            123: ("\u{F702}", "\u{F702}"), // Left arrow
            124: ("\u{F703}", "\u{F703}"), // Right arrow
            125: ("\u{F701}", "\u{F701}"), // Down arrow
            126: ("\u{F700}", "\u{F700}")  // Up arrow
        ]
        
        if let mapping = keyMap[keyCode] {
            return isShiftPressed ? mapping.shifted : mapping.normal
        }
        
        return nil
    }
    
    private func sendKeyEvent(_ event: KeyEvent) {
        if let data = try? JSONEncoder().encode(event),
           let json = String(data: data, encoding: .utf8) {
            print(json)
            fflush(stdout)
        }
    }
    
    private func sendResponse(type: String, data: [String: AnyCodable]?) {
        let response = Response(type: type, data: data, error: nil)
        if let jsonData = try? JSONEncoder().encode(response),
           let json = String(data: jsonData, encoding: .utf8) {
            print(json)
            fflush(stdout)
        }
    }
    
    private func sendStatus(message: String, ready: Bool) {
        sendResponse(type: "status", data: [
            "message": AnyCodable(message),
            "ready": AnyCodable(ready)
        ])
    }
    
    private func sendError(message: String) {
        let response = Response(type: "error", data: nil, error: message)
        if let jsonData = try? JSONEncoder().encode(response),
           let json = String(data: jsonData, encoding: .utf8) {
            print(json)
            fflush(stdout)
        }
    }
    
    private func shutdown() {
        stopCapture()
        sendResponse(type: "shutdown", data: nil)
        exit(0)
    }
}

let manager = KeyHookManager()
manager.start()
