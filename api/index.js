const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { parsePDF, extract신청서, extract행복드림신청서, extract상권리포트 } = require('../pdf-parser');
const { analyze, analyzeHappyDream, expandSection, calcOperating, industryTypes } = require('../analyzer');

const app = express();
app.use(express.json({ limit: '50mb' }));

// multer memory storage (Vercel serverless - no disk writes)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

// API Routes
app.get('/api/templates', (req, res) => {
  try {
    const files = fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.pptx'));
    res.json(files.map(f => ({ id: path.basename(f, '.pptx'), name: path.basename(f, '.pptx'), filename: f })));
  } catch (err) {
    res.json([]);
  }
});

app.get('/api/industries', (req, res) => res.json(industryTypes));

app.post('/api/parse', upload.fields([
  { name: 'sinchungseo', maxCount: 1 },
  { name: 'sangkwon', maxCount: 1 }
]), async (req, res) => {
  try {
    const result = {};
    const templateId = req.body && req.body.templateId ? req.body.templateId : '홍보마케팅';

    // Write uploaded buffers to /tmp so pdf2json can read by path
    const tmpDir = '/tmp';
    const writes = [];

    if (req.files.sinchungseo && req.files.sinchungseo[0]) {
      const tmpPath = path.join(tmpDir, 'sin_' + Date.now() + '.pdf');
      fs.writeFileSync(tmpPath, req.files.sinchungseo[0].buffer);
      writes.push(tmpPath);

      if (templateId === '행복드림센터') {
        // OCR 미지원 안내 - Vercel 서버리스 환경 제약
        try {
          const pages = await parsePDF(tmpPath);
          // 텍스트 기반 PDF인 경우만 지원
          if (pages[0] && pages[0].length > 100) {
            result.sinchungseo = extract행복드림신청서(pages);
          } else {
            result.sinchungseo = { _warning: '이미지 스캔 PDF는 서버리스 환경에서 OCR이 지원되지 않습니다. 텍스트 기반 PDF를 업로드해주세요.' };
          }
        } catch (e) {
          result.sinchungseo = { _warning: '신청서 파싱 실패: ' + e.message };
        }
      } else {
        const pages = await parsePDF(tmpPath);
        result.sinchungseo = extract신청서(pages);
      }
    }

    if (req.files.sangkwon && req.files.sangkwon[0]) {
      const tmpPath = path.join(tmpDir, 'sang_' + Date.now() + '.pdf');
      fs.writeFileSync(tmpPath, req.files.sangkwon[0].buffer);
      writes.push(tmpPath);
      const pages = await parsePDF(tmpPath);
      result.sangkwon = extract상권리포트(pages);
    }

    // cleanup
    writes.forEach(p => { try { fs.unlinkSync(p); } catch (e) {} });

    // analysis
    if (templateId === '행복드림센터') {
      result.analysis = analyzeHappyDream(result.sinchungseo || {}, result.sangkwon || {});
    } else {
      result.analysis = analyze(result.sinchungseo || {}, result.sangkwon || {}, templateId);
    }

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

app.post('/api/recalc-operating', (req, res) => {
  try {
    const { sin, industryKey } = req.body;
    res.json({ content: calcOperating(sin || {}, industryKey) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/expand', (req, res) => {
  try {
    const { sectionName, currentContent, sin, sang, templateId } = req.body;
    const expanded = expandSection(sectionName, currentContent, sin || {}, sang || {}, templateId || '');
    res.json({ content: expanded });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Root → serve index.html
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, '..', 'public', 'index.html');
  res.sendFile(indexPath);
});

// Export for Vercel
module.exports = app;
