const express = require('express');
const path = require('path');
const fs = require('fs');
const PizZip = require('pizzip');
const multer = require('multer');
const { parsePDF, parsePDFWithOCR, extract신청서, extract행복드림신청서, extract상권리포트 } = require('./pdf-parser');
const { analyze, analyzeHappyDream, expandSection, calcOperating, calcOperatingAnalysis, industryTypes } = require('./analyzer');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

const upload = multer({ dest: path.join(__dirname, 'uploads') });
const TEMPLATES_DIR = path.join(__dirname, 'templates');
const OUTPUT_DIR = path.join(__dirname, 'output');

// Ensure dirs exist
[path.join(__dirname, 'uploads'), OUTPUT_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// List available templates
app.get('/api/templates', (req, res) => {
  const files = fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.pptx'));
  const templates = files.map(f => ({
    id: path.basename(f, '.pptx'),
    name: path.basename(f, '.pptx'),
    filename: f
  }));
  res.json(templates);
});

// Upload PDFs and extract data
app.post('/api/parse', upload.fields([
  { name: 'sinchungseo', maxCount: 1 },
  { name: 'sangkwon', maxCount: 1 }
]), async (req, res) => {
  try {
    const result = {};
    const templateId = req.body && req.body.templateId ? req.body.templateId : '홍보마케팅';

    if (req.files.sinchungseo && req.files.sinchungseo[0]) {
      if (templateId === '행복드림센터') {
        // 행복드림센터 신청서는 이미지 스캔 PDF일 수 있음 → OCR 사용
        const pages = await parsePDFWithOCR(req.files.sinchungseo[0].path);
        result.sinchungseo = extract행복드림신청서(pages);
      } else {
        const pages = await parsePDF(req.files.sinchungseo[0].path);
        result.sinchungseo = extract신청서(pages);
      }
      fs.unlinkSync(req.files.sinchungseo[0].path);
    }

    if (req.files.sangkwon && req.files.sangkwon[0]) {
      const pages = await parsePDF(req.files.sangkwon[0].path);
      result.sangkwon = extract상권리포트(pages);
      result.sangkwonPageText = pages; // 페이지별 원본 텍스트 (이미지 매칭용)
      fs.unlinkSync(req.files.sangkwon[0].path);
    }

    // Auto-analyze: generate report content
    if (templateId === '행복드림센터') {
      result.analysis = analyzeHappyDream(result.sinchungseo || {}, result.sangkwon || {});
    } else {
      result.analysis = analyze(result.sinchungseo || {}, result.sangkwon || {}, templateId);
    }

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Recalculate operating status with selected industry
app.post('/api/recalc-operating', express.json(), (req, res) => {
  try {
    const { sin, industryKey } = req.body;
    const content = calcOperating(sin || {}, industryKey);
    res.json({ content });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 행복드림센터 - 정보 수정 후 전체 보고서 재분석
app.post('/api/reanalyze-happydream', express.json(), (req, res) => {
  try {
    const { sin = {}, sang = {}, overrides = {} } = req.body || {};
    const mergedSin = { ...sin };
    ['업종', '업체명', '고객명', '경력', '월매출액', '월순이익', '월세', '종업원수', '창업일자', '사업장주소', '요청사항'].forEach(k => {
      if (overrides[k] !== undefined && overrides[k] !== '') mergedSin[k] = overrides[k];
    });
    const analysis = analyzeHappyDream(mergedSin, sang);
    res.json({ analysis, sin: mergedSin });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 행복드림센터 - 수동 입력값으로 영업현황 + 영업현황분석 재계산
app.post('/api/recalc-happydream', express.json(), (req, res) => {
  try {
    const { sin = {}, sang = {}, industryKey, overrides = {} } = req.body || {};
    const mergedSin = { ...sin };
    const mergedSang = { ...sang };
    ['월매출액', '월순이익', '월세', '종업원수', '경력'].forEach(k => {
      if (overrides[k] !== undefined && overrides[k] !== '') mergedSin[k] = overrides[k];
    });
    ['선택영역_월평균매출', '배후지_월평균매출', '선택영역_매출증감'].forEach(k => {
      if (overrides[k] !== undefined && overrides[k] !== '') mergedSang[k] = overrides[k];
    });

    const 영업현황 = calcOperating(mergedSin, industryKey);
    const 영업현황분석 = calcOperatingAnalysis(mergedSin, mergedSang);
    res.json({ 영업현황, 영업현황분석, sin: mergedSin, sang: mergedSang });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// List available industries
app.get('/api/industries', (req, res) => {
  res.json(industryTypes);
});

// Expand section content
app.post('/api/expand', express.json(), (req, res) => {
  try {
    const { sectionName, currentContent, sin, sang, templateId } = req.body;
    const expanded = expandSection(sectionName, currentContent, sin || {}, sang || {}, templateId || '');
    res.json({ content: expanded });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Generate PPT
app.post('/api/generate', (req, res) => {
  try {
    const { templateId, data } = req.body;
    const templatePath = path.join(TEMPLATES_DIR, templateId + '.pptx');

    if (!fs.existsSync(templatePath)) {
      return res.status(404).json({ error: '템플릿을 찾을 수 없습니다.' });
    }

    const templateBuffer = fs.readFileSync(templatePath);
    const zip = new PizZip(templateBuffer);

    // Process each slide
    const slideFiles = Object.keys(zip.files)
      .filter(n => n.match(/ppt\/slides\/slide\d+\.xml$/))
      .sort((a, b) => {
        const na = parseInt(a.match(/slide(\d+)/)[1]);
        const nb = parseInt(b.match(/slide(\d+)/)[1]);
        return na - nb;
      });

    slideFiles.forEach(sf => {
      let xml = zip.file(sf).asText();
      const slideNum = parseInt(sf.match(/slide(\d+)/)[1]);
      xml = fillSlide(xml, slideNum, templateId, data);
      // Apply 1.5 line spacing globally: replace existing 100% with 150%
      xml = xml.replace(/<a:spcPct val="100000"\/>/g, '<a:spcPct val="150000"/>');
      zip.file(sf, xml);
    });

    const output = zip.generate({ type: 'nodebuffer' });
    const filename = `${data.cover_고객명 || '고객'}_${templateId}_보고서.pptx`;
    const outputPath = path.join(OUTPUT_DIR, filename);
    fs.writeFileSync(outputPath, output);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(output);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

function fillSlide(xml, slideNum, templateId, data) {
  // Slide 1 (Cover) - same for all templates
  if (slideNum === 1) {
    xml = fillTableCell(xml, '고객명', data.cover_고객명);
    xml = fillTableCell(xml, '사업장명', data.cover_사업장명);
    xml = fillTableCell(xml, '업종', data.cover_업종);
    xml = fillTableCell(xml, '컨설턴트명(연락처)', data.cover_컨설턴트명);
    xml = fillTableCell(xml, '컨설팅 기간', data.cover_컨설팅기간);  // handled by adjacent cell match
    xml = fillTableCell(xml, '보고서 등록일', data.cover_보고서등록일);
    // For cover table: fill Row 1 cells (under each header)
    xml = fillCoverRow1(xml, data);
  }

  // Slide 2 (Basic Info) - same for all templates
  if (slideNum === 2) {
    xml = fillAdjacentCell(xml, '고객명', data.basic_고객명);
    xml = fillAdjacentCell(xml, '연령/성별', data.basic_연령성별);
    xml = fillAdjacentCell(xml, '사업장명', data.basic_사업장명);
    xml = fillAdjacentCell(xml, '업종', data.basic_업종);
    xml = fillAdjacentCell(xml, '창업일', data.basic_창업일);
    xml = fillAdjacentCell(xml, '사업자등록번호', data.basic_사업자등록번호);
    xml = fillAdjacentCell(xml, '영업시간', data.basic_영업시간);
    xml = fillEmployeeCell(xml, data.basic_종업원_총, data.basic_종업원_정직원, data.basic_종업원_시간제);
    xml = fillAdjacentCell(xml, '사업장 주소', data.basic_사업장주소);
    xml = fillAdjacentCell(xml, '사업 아이템', data.basic_사업아이템);
    xml = fillAdjacentCell(xml, '경쟁력', data.basic_경쟁력);
    xml = fillAdjacentCell(xml, '마케팅', data.basic_마케팅);
  }

  // Slide 3 (SWOT) - same for all templates
  if (slideNum === 3) {
    xml = fillSwotCell(xml, 'S', data.swot_S);
    xml = fillSwotCell(xml, 'W', data.swot_W);
    xml = fillSwotCell(xml, 'O', data.swot_O);
    xml = fillSwotCell(xml, 'T', data.swot_T);
    xml = fillShapeText(xml, '신청인 요청사항(개선점)', data.swot_요청사항);
  }

  // Template-specific slides
  if (templateId === '업종컨설팅') {
    if (slideNum === 4) xml = fillShapeContent(xml, data.진단결과);
    if (slideNum === 5) xml = fillShapeContent(xml, data.대안제시);
    if (slideNum === 6) xml = fillConsultingDays(xml, data.days || []);
    if (slideNum === 7) xml = fillShapeContent(xml, data.기타의견);
    if (slideNum === 8) xml = fillShapeContent(xml, data.종합의견);
  } else if (templateId === '사업성분석') {
    if (slideNum === 4) xml = fillPLTable(xml, data);
    if (slideNum === 5) xml = fillShapeContent(xml, data.진단결과);
    if (slideNum === 6) xml = fillShapeContent(xml, data.대안제시);
    if (slideNum === 7) xml = fillConsultingDays(xml, data.days || []);
    if (slideNum === 8) xml = fillShapeContent(xml, data.기타의견);
    if (slideNum === 9) xml = fillShapeContent(xml, data.종합의견);
  } else if (templateId === '홍보마케팅') {
    if (slideNum === 4) xml = fillShapeContent(xml, data.진단결과);
    if (slideNum === 5) xml = fillShapeContent(xml, data.대안제시_SNS);
    if (slideNum === 6) xml = fillShapeContent(xml, data.대안제시_기타);
    if (slideNum === 7) xml = fillConsultingDays(xml, data.days || []);
    if (slideNum === 8) xml = fillShapeContent(xml, data.기타의견);
    if (slideNum === 9) xml = fillShapeContent(xml, data.종합의견);
  }

  return xml;
}

// Fill the cover page Row 1 (empty cells under headers)
function fillCoverRow1(xml, data) {
  const coverValues = [
    data.cover_고객명 || '',
    data.cover_사업장명 || '',
    data.cover_업종 || '',
    data.cover_컨설턴트명 || '',
    data.cover_컨설팅기간 || '',
    data.cover_보고서등록일 || ''
  ];

  // Find all table rows
  const rows = [];
  const rowRe = /<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g;
  let rm;
  while ((rm = rowRe.exec(xml)) !== null) {
    rows.push({ start: rm.index, end: rm.index + rm[0].length, content: rm[0], inner: rm[1] });
  }

  if (rows.length >= 2) {
    // Row 1 (index 1) contains empty cells - fill them
    let row1 = rows[1].content;
    const cellRe = /<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g;
    let cm;
    let cellIdx = 0;
    const replacements = [];

    while ((cm = cellRe.exec(row1)) !== null) {
      if (cellIdx < coverValues.length && coverValues[cellIdx]) {
        const val = escapeXml(coverValues[cellIdx]);
        let cellContent = cm[0];
        // Insert run BEFORE <a:endParaRPr> so PPT renders it
        const endParaIdx = cellContent.indexOf('<a:endParaRPr');
        if (endParaIdx !== -1) {
          const newRun = `<a:r><a:rPr lang="ko-KR" dirty="0" sz="1000"/><a:t>${val}</a:t></a:r>`;
          cellContent = cellContent.substring(0, endParaIdx) + newRun + cellContent.substring(endParaIdx);
        }
        replacements.push({ original: cm[0], replacement: cellContent });
      }
      cellIdx++;
    }

    replacements.forEach(r => {
      xml = xml.replace(r.original, r.replacement);
    });
  }

  return xml;
}

// Fill adjacent empty cell in a 4-column or 2-column table layout
function fillAdjacentCell(xml, label, value) {
  if (!value) return xml;
  const val = escapeXml(value);

  // Find table cells containing the label, then fill the next cell
  const cellRe = /<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g;
  const cells = [];
  let cm;
  while ((cm = cellRe.exec(xml)) !== null) {
    const texts = extractTexts(cm[1]);
    cells.push({ start: cm.index, end: cm.index + cm[0].length, content: cm[0], text: texts.join('').trim() });
  }

  for (let i = 0; i < cells.length - 1; i++) {
    if (cells[i].text === label && (cells[i + 1].text === '' || cells[i + 1].text === '(empty)')) {
      let nextCell = cells[i + 1].content;
      nextCell = insertTextInCell(nextCell, val);
      xml = xml.replace(cells[i + 1].content, nextCell);
      break;
    }
  }

  return xml;
}

// Fill SWOT cells - the cell content is just "S", "W", "O", "T" and we append text
function fillSwotCell(xml, letter, value) {
  if (!value) return xml;
  const val = escapeXml(value);

  const cellRe = /<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g;
  let cm;
  while ((cm = cellRe.exec(xml)) !== null) {
    const texts = extractTexts(cm[1]);
    const cellText = texts.join('').trim();
    if (cellText === letter) {
      // Replace the cell content - keep letter and add new paragraph with value
      let cellContent = cm[0];
      // Add a new paragraph after the existing one with the value
      const lastParaEnd = cellContent.lastIndexOf('</a:p>');
      if (lastParaEnd !== -1) {
        const newPara = `<a:p><a:pPr><a:lnSpc><a:spcPct val="150000"/></a:lnSpc></a:pPr><a:r><a:rPr lang="ko-KR" dirty="0" sz="1000"/><a:t>${val}</a:t></a:r></a:p>`;
        cellContent = cellContent.substring(0, lastParaEnd + 6) + newPara + cellContent.substring(lastParaEnd + 6);
        xml = xml.replace(cm[0], cellContent);
      }
      break;
    }
  }

  return xml;
}

// Fill employee count cell
function fillEmployeeCell(xml, total, fulltime, parttime) {
  if (!total && !fulltime && !parttime) return xml;

  // Find the cell with "정직원" and "시간제" pattern
  const cellRe = /<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g;
  let cm;
  while ((cm = cellRe.exec(xml)) !== null) {
    const texts = extractTexts(cm[1]);
    const cellText = texts.join('');
    if (cellText.includes('정직원') && cellText.includes('시간제')) {
      let cellContent = cm[0];
      const totalVal = total || '';
      const ftVal = fulltime || '';
      const ptVal = parttime || '';
      const newText = `총 ${totalVal}명(정직원 ${ftVal}명, 시간제 ${ptVal}명)`;

      // Replace ALL paragraphs with a single new one
      const tcPropMatch = cellContent.match(/<a:tcPr[\s\S]*?<\/a:tcPr>/);
      const tcProp = tcPropMatch ? tcPropMatch[0] : '';
      // Get gridSpan if any
      const tcAttrMatch = cellContent.match(/<a:tc([^>]*)>/);
      const tcAttr = tcAttrMatch ? tcAttrMatch[1] : '';
      cellContent = `<a:tc${tcAttr}>${tcProp}<a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="ko-KR" dirty="0" sz="900"/><a:t>${escapeXml(newText)}</a:t></a:r></a:p></a:txBody></a:tc>`;
      xml = xml.replace(cm[0], cellContent);
      break;
    }
  }

  return xml;
}

// Fill P&L table for 사업성분석
function fillPLTable(xml, data) {
  const plFields = [
    { label: '1. 매출액', key: 'pl_매출액' },
    { label: '2. 매출원가', key: 'pl_매출원가' },
    { label: '3. 매출이익', key: 'pl_매출이익' },
    { label: '4. 전체경비', key: 'pl_전체경비' },
    { label: '- 인건비', key: 'pl_인건비' },
    { label: '- 임차료', key: 'pl_임차료' },
    { label: '- 관리비', key: 'pl_관리비' },
    { label: '- 수도광열비', key: 'pl_수도광열비' },
    { label: '- 기타경비', key: 'pl_기타경비' },
    { label: '- 감가상각비*', key: 'pl_감가상각비' },
    { label: '- 이자비용**', key: 'pl_이자비용' },
    { label: '5. 총이익', key: 'pl_총이익' },
  ];

  plFields.forEach(({ label, key }) => {
    if (data[key]) {
      xml = fillPLRow(xml, label, data[key]);
    }
  });

  return xml;
}

function fillPLRow(xml, label, value) {
  const val = escapeXml(value);
  // Find the row with the label and replace "만원" cell with "value만원"
  const cellRe = /<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g;
  const cells = [];
  let cm;
  while ((cm = cellRe.exec(xml)) !== null) {
    const texts = extractTexts(cm[1]);
    cells.push({ start: cm.index, end: cm.index + cm[0].length, content: cm[0], text: texts.join('').trim() });
  }

  for (let i = 0; i < cells.length - 1; i++) {
    if (cells[i].text === label && cells[i + 1].text === '만원') {
      let nextCell = cells[i + 1].content;
      // Replace "만원" with "value만원"
      nextCell = nextCell.replace(/<a:t>만원<\/a:t>/, `<a:t>${val}만원</a:t>`);
      xml = xml.replace(cells[i + 1].content, nextCell);
      break;
    }
  }

  return xml;
}

// Fill consulting days table
function fillConsultingDays(xml, days) {
  if (!days || days.length === 0) return xml;

  const rowRe = /<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g;
  const rows = [];
  let rm;
  while ((rm = rowRe.exec(xml)) !== null) {
    rows.push({ start: rm.index, content: rm[0] });
  }

  // Skip header row (index 0), fill day rows starting from index 1
  for (let i = 0; i < days.length && i + 1 < rows.length; i++) {
    const day = days[i];
    let row = rows[i + 1].content;

    // Replace date in first cell - text is "('00.00.00)" where ' is U+2018
    if (day.date) {
      row = row.replace(
        /\([\u2018\u2019'&](?:apos;)?00\.00\.00\)/g,
        `(${escapeXml(day.date)})`
      );
    }

    // Fill the 2nd cell (수행내역) and 3rd cell (수행시간)
    const cellRe2 = /<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g;
    const rowCells = [];
    let cm2;
    while ((cm2 = cellRe2.exec(row)) !== null) {
      rowCells.push({ content: cm2[0], text: extractTexts(cm2[1]).join('').trim() });
    }

    if (rowCells.length >= 3) {
      if (day.내역) {
        let cell = rowCells[1].content;
        cell = insertTextInCell(cell, escapeXml(day.내역));
        row = row.replace(rowCells[1].content, cell);
      }
      if (day.시간) {
        let cell = rowCells[2].content;
        cell = insertTextInCell(cell, escapeXml(day.시간));
        row = row.replace(rowCells[2].content, cell);
      }
    }

    xml = xml.replace(rows[i + 1].content, row);
  }

  return xml;
}

// Fill shape content (for free-text slides like 진단결과, 대안제시, etc.)
function fillShapeContent(xml, value) {
  if (!value) return xml;
  const val = escapeXml(value);

  // Find all shapes (p:sp) - look for the one that has the title but also has empty space for content
  // For these slides, there's typically one shape with just a title. We need to add content after it.
  // Actually, let's add a new paragraph to the existing shape

  const spRe = /<p:sp>([\s\S]*?)<\/p:sp>/g;
  let sm;
  const shapes = [];
  while ((sm = spRe.exec(xml)) !== null) {
    shapes.push({ start: sm.index, content: sm[0] });
  }

  if (shapes.length > 0) {
    // Find the last shape (usually the content area, or the only shape)
    const targetShape = shapes[shapes.length - 1];
    let shapeContent = targetShape.content;

    // Add content paragraphs with 1.5 line spacing
    const paragraphs = val.split('\n').map(line =>
      `<a:p><a:pPr><a:lnSpc><a:spcPct val="150000"/></a:lnSpc></a:pPr><a:r><a:rPr lang="ko-KR" dirty="0" sz="1200"/><a:t>${line}</a:t></a:r></a:p>`
    ).join('');

    const lastBodyEnd = shapeContent.lastIndexOf('</p:txBody>');
    if (lastBodyEnd !== -1) {
      shapeContent = shapeContent.substring(0, lastBodyEnd) + paragraphs + shapeContent.substring(lastBodyEnd);
      xml = xml.replace(targetShape.content, shapeContent);
    }
  }

  return xml;
}

// Fill shape that contains specific label text - add content after it
function fillShapeText(xml, label, value) {
  if (!value) return xml;
  const val = escapeXml(value);

  const spRe = /<p:sp>([\s\S]*?)<\/p:sp>/g;
  let sm;
  while ((sm = spRe.exec(xml)) !== null) {
    const texts = extractTexts(sm[1]);
    const joinedText = texts.join('').replace(/\s+/g, ' ').trim();
    if (joinedText.includes(label.replace(/\s+/g, ' '))) {
      let shapeContent = sm[0];
      const paragraphs = val.split('\n').map(line =>
        `<a:p><a:pPr><a:lnSpc><a:spcPct val="150000"/></a:lnSpc></a:pPr><a:r><a:rPr lang="ko-KR" dirty="0" sz="1100"/><a:t>${line}</a:t></a:r></a:p>`
      ).join('');

      const lastBodyEnd = shapeContent.lastIndexOf('</p:txBody>');
      if (lastBodyEnd !== -1) {
        shapeContent = shapeContent.substring(0, lastBodyEnd) + paragraphs + shapeContent.substring(lastBodyEnd);
        xml = xml.replace(sm[0], shapeContent);
      }
      break;
    }
  }

  return xml;
}

// Fill a table cell by finding the label in Row 0 and filling Row 1
function fillTableCell(xml, label, value) {
  // This is handled by fillCoverRow1 instead
  return xml;
}

// Insert text into an empty table cell
function insertTextInCell(cellXml, value) {
  // Try to find existing empty <a:t> tags
  if (cellXml.match(/<a:t>\s*<\/a:t>/)) {
    return cellXml.replace(/<a:t>\s*<\/a:t>/, `<a:t>${value}</a:t>`);
  }
  if (cellXml.match(/<a:t><\/a:t>/)) {
    return cellXml.replace(/<a:t><\/a:t>/, `<a:t>${value}</a:t>`);
  }
  // Insert run BEFORE <a:endParaRPr> (PPT ignores runs after endParaRPr)
  const endParaIdx = cellXml.indexOf('<a:endParaRPr');
  if (endParaIdx !== -1) {
    const newRun = `<a:r><a:rPr lang="ko-KR" dirty="0" sz="900"/><a:t>${value}</a:t></a:r>`;
    return cellXml.substring(0, endParaIdx) + newRun + cellXml.substring(endParaIdx);
  }
  // Fallback: insert before </a:p>
  const paraEnd = cellXml.indexOf('</a:p>');
  if (paraEnd !== -1) {
    const newRun = `<a:r><a:rPr lang="ko-KR" dirty="0" sz="900"/><a:t>${value}</a:t></a:r>`;
    return cellXml.substring(0, paraEnd) + newRun + cellXml.substring(paraEnd);
  }
  return cellXml;
}

// Extract text content from XML fragment
function extractTexts(xmlFragment) {
  const texts = [];
  const re = /<a:t>([^<]*)<\/a:t>/g;
  let m;
  while ((m = re.exec(xmlFragment)) !== null) {
    texts.push(m[1]);
  }
  return texts;
}

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`서버 시작: http://localhost:${PORT}`);
});
