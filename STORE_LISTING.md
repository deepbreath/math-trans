# Chrome Web Store Listing Draft

## Name

Math Academy Bilingual Translator

## Short description

Show bilingual translations directly on Math Academy lessons.

## Detailed description

Math Academy Bilingual Translator helps learners read Math Academy lessons in bilingual mode. It scans visible lesson text, keeps the original English content in place, and inserts a translated version below or inline.

Features:

- Bilingual translation for Math Academy lesson pages.
- Preserves math notation where possible.
- Supports Google Translate web translation, Gemini API, and OpenAI API.
- Optional inline or below-original display modes.
- Local extension settings for provider, language, and API keys.

Notes:

- The extension is designed for `mathacademy.com`.
- Gemini and OpenAI modes require the user's own API key.
- Translation text is sent to the selected translation provider.

## Single purpose statement

The extension translates visible Math Academy lesson text into a user-selected target language and displays it beside the original content.

## Privacy disclosure notes

User-provided API keys are stored in Chrome extension storage. Visible page text selected for translation is sent to the selected translation provider. The extension does not run its own backend service.

## Test instructions

1. Install the extension.
2. Open `https://www.mathacademy.com/`.
3. Open a lesson page.
4. Open the extension popup.
5. Select `Google 免费`, `Gemini API`, or `OpenAI API`.
6. If using Gemini or OpenAI, enter a valid API key.
7. Save and refresh.
8. Confirm translated text appears under or beside lesson text.
