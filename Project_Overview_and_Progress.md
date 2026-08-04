# Project Overview: Munmaek - AI Korean Word Lookup Extension

This document provides an overview of your Chrome extension project, "Munmaek - context based AI Word Lookup," and tracks the progress we've made together. It's designed to be easy to understand, especially if you're new to coding and browser extension development.

## 1. What We're Building (The Big Picture)

You're creating a **Chrome browser extension** called "Munmaek - context based AI Word Lookup."
The main goal of this extension is to help users learn Korean by providing instant, AI-powered definitions for Korean words they encounter while browsing the web.

Here's a breakdown of its core functionality:

*   **Word Detection:** When you hover your mouse over a Korean word on a webpage, the extension should detect it.
*   **Sentence Detection (with Shift key):** If you hold down the Shift key while hovering, the extension should detect the entire sentence containing the word. This is important because the meaning of a word can change based on its context.
*   **Popup Definitions:** After detecting a word (and possibly the sentence), the extension will show a small popup window. This popup will display the definition of the word.
*   **External Dictionary File:** The definitions will come from an external dictionary file (or files) that you provide. This file is crucial.
*   **Unique Word IDs for Parsing:** The extension will use this external file to assign unique IDs to each Korean word. This is especially important for the Korean language, as its structure can make it tricky to identify and parse words correctly without a good system.
*   **SRT File Context (Original Idea):** Initially, the idea was to use an uploaded SRT (subtitle) file to provide context for word definitions. This is still a feature we're considering and aiming to improve, particularly for sites like Netflix.

Essentially, you're building a smart little helper that lives in the Chrome browser and makes learning Korean more interactive and context-aware.

## 2. What We've Done So Far (Our Progress)

We've focused on laying a strong foundation for you to understand your project and plan its development:

*   **Created a Prioritized TODO List (`TODO_Features.md`):**
    *   **What it is:** This is your roadmap! It's a document that lists all the new features you want to add, improvements to existing ones, and steps to fix any known issues.
    *   **Why it's important:** For any coding project, especially when you're learning, having a clear plan is key. This list helps you tackle tasks one by one, starting with the most important ones.
    *   **What's in it:**
        *   New features (like improved word/sentence detection, better UI for the popup).
        *   Improvements (like making the Netflix subtitle extraction more reliable).
        *   A step-by-step guide on how to approach implementing each item.
*   **Added a Publishing Checklist to the TODO List:**
    *   **What it is:** We extended the `TODO_Features.md` file to include a checklist for when you're ready to share your extension with the world.
    *   **Why it's important:** Publishing an extension involves several steps, from preparing your code to listing it on the Chrome Web Store and GitHub. This checklist ensures you don't miss anything.
*   **Provided a Beginner-Friendly Codebase Explanation (`Extension_Explanation_for_Beginners.md`):**
    *   **What it is:** This is a detailed guide explaining each file in your extension's project folder.
    *   **Why it's important:** Understanding what each piece of your project does is the first step to being able to change or improve it. Since you're new to this, we created a document that explains things in simple terms, avoiding jargon where possible.
    *   **What's in it:** It describes the purpose of files like `manifest.json` (the extension's "ID card"), `content.js` (which interacts with web pages), `popup.js` (which controls the definition popup), and others. It also explains how they work together.

## 3. What's Next? (Your Learning and Development Journey)

Now that you have these foundational documents, here's the path forward:

1.  **Continue Learning and Understanding:**
    *   Use the `Extension_Explanation_for_Beginners.md` file to get comfortable with your existing code. Read through it, look at the actual files, and try to see how the explanations match up with the code. Don't worry if it doesn't all click at once – this takes time!
2.  **Start Implementing Features:**
    *   Refer to your `TODO_Features.md` file. Start with the highest priority items. We'll work together on these, breaking down each task into smaller, manageable steps.
3.  **Address Existing Issues:**
    *   We'll also tackle any pre-existing issues, like making the Netflix subtitle extraction more reliable. This was something you were working on before we started this detailed planning phase.

## 4. Your Project Files (The Code State)

These are the key files in your project that we've talked about or that are important for the extension to work:

*   `TODO_Features.md`: (We created this) Your feature list and development plan.
*   `Extension_Explanation_for_Beginners.md`: (We created this) Your guide to understanding the project files.
*   `Project_Overview_and_Progress.md`: (This file!) An overview of what we're doing and have done.
*   `manifest.json`:
    *   **What it is:** The most important file for any Chrome extension. It's a JSON file that tells Chrome everything it needs to know about your extension: its name, version, what permissions it needs (like accessing web pages), which scripts to run, and where to find its icon and popup window.
    *   **Your version:** You've named your extension "Munmaek - context based AI Word Lookup" in this file.
*   `background.js`:
    *   **What it is:** This script runs in the background, even when you're not directly interacting with the extension's popup. It handles tasks like listening for events (e.g., when you switch tabs) or managing long-term processes.
*   `content.js`:
    *   **What it is:** This script is injected directly into the web pages you visit. It's the part of your extension that can "see" and "interact with" the content of those pages, like detecting hovered words.
*   `popup.html` & `popup.js`:
    *   **What they are:** `popup.html` defines the structure and appearance of the little window that pops up with the word definition. `popup.js` contains the logic for what happens in that popup (e.g., fetching and displaying the definition).
*   `options.html` & `options.js`:
    *   **What they are:** These files allow you to create an "options" page for your extension. Users could go here to customize settings (e.g., choose a default dictionary, change how the popup looks).
*   `korean_words.json` (and the `dictionaries/` folder):
    *   **What it is:** This is likely where your Korean word data and definitions are stored, or where they will be. The `dictionaries/` folder with `KO-EN.KRDICT` and `KO-JA.KRDICT` suggests you have structured dictionary data. This is the "external file" we've mentioned.
*   `netflix_subtitle_extractor.js`:
    *   **What it is:** This script is specifically designed to try and grab subtitles from Netflix. This is a tricky task because websites like Netflix often change how they display content, which can break such scripts.
*   `assets/`:
    *   **What it is:** This folder holds images, like the icons for your extension (`icon16.png`, `icon48.png`, etc.).
*   `.vscode/tasks.json`:
    *   **What it is:** This is a configuration file for Visual Studio Code (your code editor). It can define common tasks you might want to run, like building your project or running tests. (This was mentioned in the explanation guide as a possibility, you may or may not have this file yet).

## 5. Changes We (The Assistant) Made:

So far, I (your AI assistant) have focused on helping you plan and understand:

*   **Created `TODO_Features.md`:** Wrote the initial list of features, improvements, and the publishing checklist.
*   **Created `Extension_Explanation_for_Beginners.md`:** Wrote the detailed guide to your project's files.
*   **Created `Project_Overview_and_Progress.md`:** (This document) Wrote this summary.

I haven't directly changed any of your extension's core code files (like `.js` or `.html` files) yet. Our work has been about setting you up for success!

---

Feel free to ask any questions as you read through this or as you explore your code. Learning to code and building a project like this is a marathon, not a sprint, and it's okay to take it one step at a time!
