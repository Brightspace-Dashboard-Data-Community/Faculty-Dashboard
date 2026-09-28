import { env, pipeline } from "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2";

(function () {
  "use strict";

  var INSTRUCTION_MODEL = "Xenova/flan-t5-small";
  var MAX_TRANSCRIPT_CHARS = 22000;
  var MAX_CHUNK_WORDS = 260;
  var instructionPromise = null;

  var form = document.getElementById("learningCompanionForm");
  var generateBtn = document.getElementById("generateCompanionBtn");
  var messageEl = document.getElementById("companionMessage");
  var notesOutput = document.getElementById("notesOutput");
  var copyNotesBtn = document.getElementById("copyNotesBtn");

  function setMessage(message, type) {
    if (!messageEl) return;
    if (!message) {
      messageEl.style.display = "none";
      messageEl.className = "message-container";
      messageEl.textContent = "";
      return;
    }
    messageEl.style.display = "block";
    messageEl.className = "message-container " + (type === "error" ? "message-error" : "message-success");
    messageEl.textContent = message;
  }

  function normalizeWhitespace(value) {
    return String(value || "")
      .replace(/\r/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function dedupeNearRepeatedSentences(text) {
    var rawSentences = text.split(/(?<=[.!?])\s+/);
    var output = [];
    var recent = [];
    for (var i = 0; i < rawSentences.length; i++) {
      var sentence = rawSentences[i].trim();
      if (!sentence) continue;
      var key = sentence.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
      if (!key) continue;
      if (recent.indexOf(key) !== -1) {
        continue;
      }
      output.push(sentence);
      recent.push(key);
      if (recent.length > 24) {
        recent.shift();
      }
    }
    return output.join(" ");
  }

  function sanitizeTranscript(value) {
    return dedupeNearRepeatedSentences(normalizeWhitespace(value));
  }

  function clipTranscript(text) {
    if (text.length <= MAX_TRANSCRIPT_CHARS) {
      return { text: text, clipped: false };
    }
    return { text: text.slice(0, MAX_TRANSCRIPT_CHARS), clipped: true };
  }

  async function getInstructionModel() {
    if (instructionPromise) {
      return instructionPromise;
    }
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    instructionPromise = pipeline("text2text-generation", INSTRUCTION_MODEL);
    return instructionPromise;
  }

  async function runInstruction(prompt, maxTokens) {
    var generator = await getInstructionModel();
    var result = await generator(prompt, {
      max_new_tokens: maxTokens,
      do_sample: false,
      num_beams: 4,
      repetition_penalty: 1.15
    });
    if (!result || !result.length || !result[0].generated_text) {
      return "";
    }
    return String(result[0].generated_text).trim();
  }

  function chunkTextByWords(text, maxWords) {
    var words = text.split(/\s+/).filter(Boolean);
    var chunks = [];
    for (var i = 0; i < words.length; i += maxWords) {
      chunks.push(words.slice(i, i + maxWords).join(" "));
    }
    return chunks;
  }

  function pause(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function cleanSentence(sentence) {
    return sentence.replace(/\s+/g, " ").trim();
  }

  function sentenceSplit(text) {
    return text.split(/(?<=[.!?])\s+/).map(cleanSentence).filter(Boolean);
  }

  function extractiveCondense(text, maxSentences) {
    var sentences = sentenceSplit(text);
    if (!sentences.length) return text;
    if (sentences.length <= maxSentences) return sentences.join(" ");
    var keep = [];
    var step = Math.max(1, Math.floor(sentences.length / maxSentences));
    for (var i = 0; i < sentences.length && keep.length < maxSentences; i += step) {
      keep.push(sentences[i]);
    }
    return keep.join(" ");
  }

  async function summarizeTranscript(text) {
    var chunks = chunkTextByWords(text, MAX_CHUNK_WORDS);
    var summaries = [];

    for (var i = 0; i < chunks.length; i++) {
      // Yield to the browser so the page stays responsive.
      await pause(0);
      var chunk = extractiveCondense(chunks[i], 8);
      var prompt = [
        "Summarize this lecture chunk in 4-6 concise bullet points.",
        "Keep only core concepts, definitions, and cause/effect claims.",
        "",
        "Chunk:",
        chunk
      ].join("\n");
      var summary = await runInstruction(prompt, 160);
      if (summary) summaries.push(summary);
    }

    return summaries.join(" ");
  }

  function buildNotesPrompt(transcript, noteStyle, topic) {
    return [
      "You are an instructional designer helping a college instructor.",
      "Create a student-facing note-taking guide using ONLY the source content provided.",
      "Return plain text only and follow this exact structure:",
      "TITLE",
      "LEARNING OBJECTIVES (3-5 bullets)",
      "KEY TERMS (6-10 terms with short definitions)",
      "GUIDED NOTES (section headings with bullets and fill-in prompts)",
      "RETRIEVAL PRACTICE (4 short prompts)",
      "EXIT TICKET (2 questions)",
      "",
      "Requirements:",
      "- Use style: " + noteStyle,
      "- Do not copy transcript wording verbatim for long stretches",
      "- Keep language clear for first-year college students",
      "- Keep total length under 700 words",
      "",
      topic ? "Lecture topic: " + topic : "Lecture topic: (not provided)",
      "",
      "Source content:",
      transcript,
      "",
      "Begin now."
    ].join("\n");
  }

  function updateCopyButtons() {
    copyNotesBtn.disabled = !notesOutput.value.trim();
  }

  async function copyOutput(textarea, label) {
    var value = textarea.value.trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setMessage(label + " copied to clipboard.", "success");
    } catch (err) {
      setMessage("Could not copy " + label.toLowerCase() + ". Try manual copy.", "error");
    }
  }

  async function onSubmit(event) {
    event.preventDefault();
    setMessage("", "");

    var topic = document.getElementById("lectureTopic").value.trim();
    var noteStyle = document.getElementById("noteStyle").value;
    var rawTranscript = document.getElementById("transcriptInput").value;
    var transcript = sanitizeTranscript(rawTranscript);

    if (!transcript) {
      setMessage("Please paste a lecture transcript first.", "error");
      return;
    }

    var clipped = clipTranscript(transcript);
    notesOutput.value = "";
    updateCopyButtons();
    generateBtn.disabled = true;
    generateBtn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Generating...';

    try {
      setMessage("Model is loading and processing. First run can take 1-2 minutes. Please keep this tab open.", "success");
      await pause(50);
      setMessage("Cleaning transcript and building a chunked lecture summary...", "success");
      var condensedTranscript = await summarizeTranscript(clipped.text);
      if (!condensedTranscript) {
        throw new Error("Could not summarize transcript.");
      }

      await pause(0);
      setMessage("Generating aligned note-taking guide...", "success");
      var notesPrompt = buildNotesPrompt(condensedTranscript, noteStyle, topic);
      var notes = await runInstruction(notesPrompt, 720);
      if (!notes) {
        throw new Error("Model did not return notes.");
      }
      notesOutput.value = notes;

      if (clipped.clipped) {
        setMessage("Generation complete. Transcript was trimmed to the first " + MAX_TRANSCRIPT_CHARS + " characters for browser performance.", "success");
      } else {
        setMessage("Generation complete. Review and edit output before using in D2L.", "success");
      }
      updateCopyButtons();
    } catch (error) {
      console.error("AI companion generation failed:", error);
      setMessage("Generation failed. Please try again with a shorter transcript chunk.", "error");
    } finally {
      generateBtn.disabled = false;
      generateBtn.innerHTML = '<i class="fas fa-wand-magic-sparkles" aria-hidden="true"></i> Generate Note Guide';
    }
  }

  form.addEventListener("submit", onSubmit);
  copyNotesBtn.addEventListener("click", function () { copyOutput(notesOutput, "Notes"); });
})();
