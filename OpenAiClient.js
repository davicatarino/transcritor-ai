import { configureEnv } from './config.js';
import OpenAI from 'openai';

// Configura as variáveis de ambiente
configureEnv();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_KEY, // Corrija para OPENAI_KEY se necessário
});

export default openai;
