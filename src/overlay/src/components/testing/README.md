# Automation Testing Utility

A standalone testing tool for debugging automation actions in isolation.

## How to Use

### Opening the Tester

Press **`Cmd+Shift+T`** (or `Ctrl+Shift+T` on Windows/Linux) from any overlay window to open the Automation Tester.

### Available Tests

#### 1. **OCR Test**
- Captures a screenshot of the current screen
- Runs Tesseract.js OCR to extract all text
- Shows detected text blocks with confidence scores and positions
- **Use this to verify OCR is working correctly**

#### 2. **Find Element**
- Enter a description of an element (e.g., "search input field")
- Uses Vision API to locate the element
- Returns coordinates if found
- **Use this to test element detection before clicking**

#### 3. **Type Text**
- Enter text to type
- Executes keyboard typing using nut.js
- **Use this to test typing without full automation**

#### 4. **Click Element**
- Enter a description of an element to click
- Finds the element using Vision API
- Clicks at the detected coordinates
- **Use this to test the full click workflow**

## Testing Workflow

### Debugging Failed Automation

1. **Start with OCR Test**
   - Open the page where automation failed (e.g., Perplexity)
   - Press `Cmd+Shift+T` to open tester
   - Run OCR Test
   - Verify the text you expect is being detected
   - Check confidence scores (should be >70%)

2. **Test Element Detection**
   - Use "Find Element" test
   - Enter the exact description the automation used
   - See if it finds the correct coordinates
   - If it fails, try different descriptions

3. **Test Individual Actions**
   - Test typing with "Type Text"
   - Test clicking with "Click Element"
   - Verify each action works in isolation

### Example: Testing Perplexity Search

```
1. Open Perplexity in browser
2. Press Cmd+Shift+T
3. Select "OCR Test" → Run Test
   - Verify "Ask anything" text is detected
4. Select "Find Element"
   - Enter: "search input field"
   - Run Test → Should return coordinates
5. Select "Type Text"
   - Enter: "best runners"
   - Run Test → Should type in focused field
6. Select "Click Element"
   - Enter: "search input field"
   - Run Test → Should click and focus the field
```

## Troubleshooting

### OCR Not Detecting Text
- Check if text is visible on screen
- Ensure text has good contrast
- Try zooming in on the page
- Check screenshot preview in tester

### Element Not Found
- Try more specific descriptions
- Use visual landmarks (e.g., "input field below Perplexity logo")
- Check if element is actually visible
- Verify element isn't hidden behind overlay

### Actions Not Working
- Ensure app has accessibility permissions
- Check console logs for errors
- Verify nut.js is installed correctly
- Test with simpler actions first

## Screenshots

All screenshots captured during testing are automatically saved to:
```
~/.thinkdrop/screenshots/
```

Review these to see exactly what the automation sees.

## Architecture

- **Frontend**: `AutomationTester.tsx` - React component with UI
- **IPC Handler**: `ipc-handlers-automation.cjs` - OCR analysis endpoint
- **Backend API**: `/api/vision/ocr` - Tesseract.js OCR processing
- **Capabilities**: `capabilities.ts` - Action execution functions

## Tips

- Test in isolation before running full automation
- Start simple (OCR) and work up to complex (Click)
- Use screenshots to debug visual issues
- Check confidence scores for OCR reliability
- Test on the actual page/app where automation will run
