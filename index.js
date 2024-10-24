import Queue from 'bull';
import express from 'express';
import multer from 'multer';
import openai from './OpenAiClient.js'; 
import fs from 'fs';
import path from 'path';
import FfmpegCommand from 'fluent-ffmpeg';
import { fileURLToPath } from 'url'; 
import { Document, Packer, Paragraph, TextRun } from 'docx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

FfmpegCommand.setFfmpegPath('C:/ffmpeg-master-latest-win64-gpl/bin/ffmpeg.exe');

const app = express();

// Cria uma fila para o processamento de transcrições
const transcribeQueue = new Queue('transcriptions', {
  redis: {
    host: '127.0.0.1',
    port: 6379
  }
});

// Processa cada item na fila
transcribeQueue.process(1, async (job, done) => {
  try {
    const { audioPath, mp3Path, originalName } = job.data;

    // Converter o arquivo de áudio para MP3
    await convertToMp3(audioPath, mp3Path);

    // Enviar o arquivo MP3 convertido para a API da OpenAI
    const response = await openai.audio.transcriptions.create({
      file: fs.createReadStream(mp3Path),
      model: 'whisper-1',
      prompt: 'organize a transcrição em tópicos para cada assunto.',
    });

    const transcricao = response.text;

    // Salvar a transcrição em um arquivo .docx com codificação UTF-8
    const docxPath = await saveTranscriptionToDocx(transcricao, originalName);

    // Apagar os arquivos de áudio após a transcrição
    fs.unlinkSync(audioPath);
    fs.unlinkSync(mp3Path);

    done(null, { transcricao, docxPath });
  } catch (error) {
    done(new Error('Falha ao processar a transcrição.'));
  }
});

// Função para converter o arquivo de áudio para MP3
const convertToMp3 = (inputPath, outputPath) => {
  return new Promise((resolve, reject) => {
    FfmpegCommand(inputPath)
      .output(outputPath)
      .toFormat('mp3')
      .on('end', () => {
        console.log('Conversão para MP3 finalizada:', outputPath);
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('Erro durante a conversão para MP3:', err);
        reject(err);
      })
      .run();
  });
};

// Função para salvar a transcrição em um arquivo .docx com codificação correta
const saveTranscriptionToDocx = (text, originalName) => {
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            children: [new TextRun(text)],
          }),
        ],
      },
    ],
  });

  // Garante a codificação correta ao manipular o nome do arquivo
  const docxPath = `transcricoes/${Buffer.from(path.parse(originalName).name, 'utf-8')}.docx`;

  return Packer.toBuffer(doc).then((buffer) => {
    fs.writeFileSync(docxPath, buffer);
    return docxPath;
  });
};

// Configuração do Multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'transcricoes/');
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  },
});
const upload = multer({ storage: storage });

// Rota para transcrever múltiplos áudios
app.post('/transcrever', upload.array('audio', 10), async (req, res) => {
  try {
    const jobPromises = req.files.map(file => {
      const audioPath = file.path;
      const mp3Path = path.join('transcricoes', `${path.parse(file.originalname).name}.mp3`);

      // Adicionar cada trabalho de transcrição à fila
      return transcribeQueue.add({ audioPath, mp3Path, originalName: file.originalname });
    });

    // Aguarda o processamento da fila
    const results = await Promise.all(jobPromises);

    res.json(results);
    console.log("Todos os áudios foram enviados para processamento");
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ erro: 'Ocorreu um erro ao enviar os áudios para a fila.' });
  }
});

// Rota para servir o arquivo index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(3000, () => {
  console.log('Servidor rodando em http://localhost:3000');
});
