 import Document from '../models/Document.js';
import Flashcard from '../models/Flashcard.js';
import Quiz from '../models/Quiz.js';
import ChatHistory from '../models/ChatHistory.js';
import * as geminiService from '../utils/geminiService.js';
import { findRelevantChunks } from '../utils/textChunker.js';

// Greeting handler
const getGreetingResponse = (text) => {
  if (!text) return null;

  const normalized = text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z\s]/g, '')
    .trim();

  const compact = normalized.replace(/\s+/g, '');

  if (/^(hi|hii|hey|hello)\b/.test(normalized)) {
    return "Hello 👋 How can I help you?";
  }

  if (compact.startsWith("goodmorning")) {
    return "Good Morning ☀️ How can I help you?";
  }

  if (compact.startsWith("goodafternoon")) {
    return "Good Afternoon 🌤️ How can I help you?";
  }

  if (compact.startsWith("goodevening")) {
    return "Good Evening 🌆 How can I help you?";
  }

  return null;
};

// Generate flashcards
export const generateFlashcards = async (req, res, next) => {
  try {
    const { documentId, count = 10 } = req.body;

    if (!documentId) {
      return res.status(400).json({ success: false, error: 'Please provide documentId', statusCode: 400 });
    }

    const document = await Document.findOne({
      _id: documentId,
      userId: req.user._id,
      status: 'ready'
    });

    if (!document) {
      return res.status(404).json({ success: false, error: 'Document not found or not ready', statusCode: 404 });
    }

    const cards = await geminiService.generateFlashcards(
      document.extractedText,
      parseInt(count)
    );

    const flashcardSet = await Flashcard.create({
      userId: req.user._id,
      documentId: document._id,
      cards: cards.map(card => ({
        question: card.question,
        answer: card.answer,
        difficulty: card.difficulty,
        reviewCount: 0,
        isStarred: false
      }))
    });

    res.status(201).json({ success: true, data: flashcardSet, message: 'Flashcards generated successfully' });

  } catch (error) {
    next(error);
  }
};

// Generate quiz
export const generateQuiz = async (req, res, next) => {
  try {
    const { documentId, numQuestions = 5, title } = req.body;

    if (!documentId) {
      return res.status(400).json({ success: false, error: 'Please provide documentId', statusCode: 400 });
    }

    const document = await Document.findOne({
      _id: documentId,
      userId: req.user._id,
      status: 'ready'
    });

    if (!document) {
      return res.status(404).json({ success: false, error: 'Document not found or not ready', statusCode: 404 });
    }

    const questions = await geminiService.generateQuiz(
      document.extractedText,
      parseInt(numQuestions)
    );

    const quiz = await Quiz.create({
      userId: req.user._id,
      documentId: document._id,
      title: title || `${document.title} - Quiz`,
      questions,
      totalQuestions: questions.length,
      userAnswers: [],
      score: 0
    });

    res.status(201).json({ success: true, data: quiz, message: 'Quiz generated successfully' });

  } catch (error) {
    next(error);
  }
};

// Generate summary
export const generateSummary = async (req, res, next) => {
  try {
    const { documentId } = req.body;

    if (!documentId) {
      return res.status(400).json({ success: false, error: 'Please provide documentId', statusCode: 400 });
    }

    const document = await Document.findOne({
      _id: documentId,
      userId: req.user._id,
      status: 'ready'
    });

    if (!document) {
      return res.status(404).json({ success: false, error: 'Document not found or not ready', statusCode: 404 });
    }

    const summary = await geminiService.generateSummary(document.extractedText);

    res.status(200).json({
      success: true,
      data: { documentId: document._id, title: document.title, summary },
      message: 'Summary generated successfully'
    });

  } catch (error) {
    next(error);
  }
};

// Chat with greeting support
export const chat = async (req, res, next) => {
  try {
    const { documentId, question } = req.body;

    if (!documentId || !question) {
      return res.status(400).json({ success: false, error: 'Please provide documentId and question', statusCode: 400 });
    }

    const document = await Document.findOne({
      _id: documentId,
      userId: req.user._id,
      status: 'ready'
    });

    if (!document) {
      return res.status(404).json({ success: false, error: 'Document not found or not ready', statusCode: 404 });
    }

    let chatHistory = await ChatHistory.findOne({
      userId: req.user._id,
      documentId: document._id
    });

    if (!chatHistory) {
      chatHistory = await ChatHistory.create({
        userId: req.user._id,
        documentId: document._id,
        messages: []
      });
    }

    // Greeting check
    const greetingResponse = getGreetingResponse(question);

    if (greetingResponse) {
      chatHistory.messages.push(
        { role: 'user', content: question, timestamp: new Date(), relevantChunks: [] },
        { role: 'assistant', content: greetingResponse, timestamp: new Date(), relevantChunks: [] }
      );

      await chatHistory.save();

      return res.status(200).json({
        success: true,
        data: { question, answer: greetingResponse, relevantChunks: [], chatHistoryId: chatHistory._id },
        message: 'Greeting response'
      });
    }

    // Normal AI flow
    const relevantChunks = findRelevantChunks(document.chunks, question, 3);
    const chunkIndices = relevantChunks.map(c => c.chunkIndex);

    const answer = await geminiService.chatWithContext(question, relevantChunks);

    chatHistory.messages.push(
      { role: 'user', content: question, timestamp: new Date(), relevantChunks: [] },
      { role: 'assistant', content: answer, timestamp: new Date(), relevantChunks: chunkIndices }
    );

    await chatHistory.save();

    res.status(200).json({
      success: true,
      data: { question, answer, relevantChunks: chunkIndices, chatHistoryId: chatHistory._id },
      message: 'Response generated successfully'
    });

  } catch (error) {
    next(error);
  }
};

// Explain concept
export const explainConcept = async (req, res, next) => {
  try {
    const { documentId, concept } = req.body;

    if (!documentId || !concept) {
      return res.status(400).json({ success: false, error: 'Please provide documentId and concept', statusCode: 400 });
    }

    const document = await Document.findOne({
      _id: documentId,
      userId: req.user._id,
      status: 'ready'
    });

    if (!document) {
      return res.status(404).json({ success: false, error: 'Document not found or not ready', statusCode: 404 });
    }

    const relevantChunks = findRelevantChunks(document.chunks, concept, 3);
    const context = relevantChunks.map(c => c.content).join('\n\n');

    const explanation = await geminiService.explainConcept(concept, context);

    res.status(200).json({
      success: true,
      data: { concept, explanation, relevantChunks: relevantChunks.map(c => c.chunkIndex) },
      message: 'Explanation generated successfully'
    });

  } catch (error) {
    next(error);
  }
};

// Get chat history
export const getChatHistory = async (req, res, next) => {
  try {
    const { documentId } = req.params;

    const chatHistory = await ChatHistory.findOne({
      userId: req.user._id,
      documentId
    }).select('messages');

    if (!chatHistory) {
      return res.status(200).json({ success: true, data: [], message: 'No chat history found' });
    }

    res.status(200).json({
      success: true,
      data: chatHistory.messages,
      message: 'Chat history retrieved successfully'
    });

  } catch (error) {
    next(error);
  }
};
