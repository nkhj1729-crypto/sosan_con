const PDFParser = require('pdf2json');

function parsePDF(filepath) {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();
    pdfParser.on('pdfParser_dataReady', (pdfData) => {
      const pages = pdfData.Pages.map((page) => {
        const texts = page.Texts.map(t => {
          try { return decodeURIComponent(t.R[0].T); }
          catch (e) { return t.R[0].T; }
        });
        return normalizeKoreanSpaces(texts.join(' '));
      });
      resolve(pages);
    });
    pdfParser.on('pdfParser_dataError', (err) => reject(err));
    pdfParser.loadPDF(filepath);
  });
}

function normalizeKoreanSpaces(text) {
  return text
    .replace(/([\uAC00-\uD7AF\u3131-\u318E]) ([\uAC00-\uD7AF\u3131-\u318E])/g, '$1$2')
    .replace(/([\uAC00-\uD7AF\u3131-\u318E]) ([\uAC00-\uD7AF\u3131-\u318E])/g, '$1$2')
    .replace(/([\uAC00-\uD7AF\u3131-\u318E]) ([\uAC00-\uD7AF\u3131-\u318E])/g, '$1$2')
    .replace(/(\d) (\d)/g, '$1$2')
    .replace(/(\d) (\d)/g, '$1$2')
    .replace(/(\d) (\d)/g, '$1$2')
    .replace(/(\d) (\d)/g, '$1$2')
    .replace(/([A-Z]) (\d)/g, '$1$2')
    .replace(/(\d) ([A-Z])/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

// ===== 신청서 (업체정보) PDF 파싱 =====
function extract신청서(pages) {
  const text = pages.join(' ');
  const data = {};

  // 성명/성별
  const nameMatch = text.match(/성명\s*\/\s*성별\s*(\S+?)\s*\(\s*([여남])\s*\)/);
  if (nameMatch) {
    data.고객명 = nameMatch[1];
    data.성별 = nameMatch[2];
  }

  // 생년월일
  const birthMatch = text.match(/생년월일\s*(\d{4})\s*-\s*(\d{2})\s*-\s*(\d{2})/);
  if (birthMatch) {
    data.생년월일 = `${birthMatch[1]}-${birthMatch[2]}-${birthMatch[3]}`;
    data.연령 = new Date().getFullYear() - parseInt(birthMatch[1]);
  }

  // 연락처 (휴대전화)
  const phoneMatch = text.match(/연락처\s*\(\s*휴대전화\s*\)\s*(\d{10,11})/);
  if (phoneMatch) {
    const p = phoneMatch[1];
    data.연락처 = p.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
  }

  // 사업장 주소 - between "사업장주소 (우편번호)" and "대출종류"
  const addrMatch = text.match(/사업장주소\s*\(\s*\d+\s*\)\s*(.+?)(?=대출종류)/s);
  if (addrMatch) {
    data.사업장주소 = addrMatch[1].replace(/\s+/g, ' ').trim();
  }

  // 업체명
  const bizNameMatch = text.match(/업체명(\S+?)업종/);
  if (bizNameMatch) data.업체명 = bizNameMatch[1];

  // 업종
  const bizTypeMatch = text.match(/업종(.+?)사업아이템/);
  if (bizTypeMatch) data.업종 = bizTypeMatch[1].trim();

  // 사업 아이템
  const itemMatch = text.match(/사업아이템(.+?)임차현황/);
  if (itemMatch) data.사업아이템 = itemMatch[1].trim();

  // 사업자등록번호 - pattern like "191 - - 5 - 9 - 008" or "191-5-9-008"
  const regMatch = text.match(/사업자등록번호\s*([\d\s-]+?)보증금/);
  if (regMatch) data.사업자등록번호 = regMatch[1].replace(/\s/g, '').trim();

  // 보증금
  const depositMatch = text.match(/보증금\s*([\d,]+)\s*만원/);
  if (depositMatch) data.보증금 = depositMatch[1].replace(/,/g, '');

  // 창업일자
  const foundMatch = text.match(/창업일자\s*(\d{4})\s*-\s*(\d{2})\s*-\s*(\d{2})/);
  if (foundMatch) data.창업일자 = `${foundMatch[1]}-${foundMatch[2]}-${foundMatch[3]}`;

  // 월세
  const rentMatch = text.match(/월세\s*([\d,]+)\s*만원/);
  if (rentMatch) data.월세 = rentMatch[1].replace(/,/g, '');

  // 종업원수
  const empMatch = text.match(/종업원수\s*(\d+)\s*명/);
  if (empMatch) data.종업원수 = empMatch[1];

  // 월매출액
  const salesMatch = text.match(/월매출액\s*([\d,]+)\s*만원/);
  if (salesMatch) data.월매출액 = salesMatch[1].replace(/,/g, '');

  // 경력
  const expMatch = text.match(/해당분야경력\s*(\d+)\s*년/);
  if (expMatch) data.경력 = expMatch[1] + '년';

  // 월순이익
  const profitMatch = text.match(/월순이익\s*([\d,]+)\s*만원/);
  if (profitMatch) data.월순이익 = profitMatch[1].replace(/,/g, '');

  // 컨설팅 요청사항
  const reqMatch = text.match(/기타사항\s*\(\s*비고\s*\)\s*(.+?)컨설팅완료일자/s);
  if (reqMatch) data.요청사항 = reqMatch[1].trim();

  // 대출 신청 금액
  const loanMatch = text.match(/대출신청금액\s*([\d,]+)\s*만원/);
  if (loanMatch) data.대출신청금액 = loanMatch[1].replace(/,/g, '');

  // 임차구분
  const leaseMatch = text.match(/임차구분(\S+?)사업자등록번호/);
  if (leaseMatch) data.임차구분 = leaseMatch[1];

  // 등록일
  const regDateMatch = text.match(/등록일\s*(\d{4})\s*-\s*(\d{2})\s*-\s*(\d{2})/);
  if (regDateMatch) data.등록일 = `${regDateMatch[1]}-${regDateMatch[2]}-${regDateMatch[3]}`;

  // 사업현황 (기존/예비)
  const statusMatch = text.match(/사업현황(.+?)컨설턴트/);
  if (statusMatch) data.사업현황 = statusMatch[1].trim();

  // 신청사유
  const reasonMatch = text.match(/신청사유\s*:\s*(.+?)(?=업체명)/);
  // Not commonly needed

  return data;
}

// ===== 상권분석리포트 PDF 파싱 =====
function extract상권리포트(pages) {
  const text = pages.join(' ');
  const data = {};

  // Page 1: 분석지역 & 업종
  if (pages[0]) {
    const p1Match = pages[0].match(/상권분석리포트(.+?)$/);
    if (p1Match) {
      const loc = p1Match[1].trim();
      // Last word is usually the 업종
      const parts = loc.split(/(?<=동)\s*/);
      if (parts.length >= 1) data.분석지역 = loc;
    }
  }

  // Page 3: 요약 - 상권 기본 정보
  if (pages[2]) {
    const p3 = pages[2];

    // 분석지역: look for the last occurrence of "분석지역" before "분석일자"
    const regionMatch = p3.match(/분석지역(\S+?\s*\S+?\s*\S+?\s*\d+\s*동)/);
    if (regionMatch) data.분석지역 = regionMatch[1].trim();

    const dateMatch = p3.match(/분석일자\s*(\d{4})\s*년\s*(\d{2})\s*월\s*(\d{2})\s*일/);
    if (dateMatch) data.분석일자 = `${dateMatch[1]}.${dateMatch[2]}.${dateMatch[3]}`;

    const bizMatch = p3.match(/분석업종(\S+?)상권/);
    if (bizMatch) data.분석업종 = bizMatch[1];

    // 업소수: "17 개 0 . 0 % 849 개"
    const shopMatch = p3.match(/증감율\s*(\d+)\s*개\s*([\d.-]+)\s*\.\s*(\d+)\s*%\s*(\d+)\s*개/);
    if (shopMatch) {
      data.선택영역_업소수 = shopMatch[1];
      data.선택영역_업소수증감 = shopMatch[2] + '.' + shopMatch[3] + '%';
      data.배후지_업소수 = shopMatch[4];
    }

    // 월평균매출: "188 만원 - 13 . 5 % ... 304 만원 3 . 4 %"
    const salesMatch = p3.match(/매출액전월대비\s*증감율\s*(\d+)\s*만원\s*([-]?\s*\d+)\s*\.\s*(\d+)\s*%.*?매출액전월대비\s*증감율\s*(\d+)\s*만원\s*([-]?\s*\d+)\s*\.\s*(\d+)\s*%/);
    if (salesMatch) {
      data.선택영역_월평균매출 = salesMatch[1] + '만원';
      data.선택영역_매출증감 = (salesMatch[2] + '.' + salesMatch[3]).replace(/\s/g, '') + '%';
      data.배후지_월평균매출 = salesMatch[4] + '만원';
      data.배후지_매출증감 = (salesMatch[5] + '.' + salesMatch[6]).replace(/\s/g, '') + '%';
    }

    // 분석결과 해설
    const analysisMatch = p3.match(/분석결과\s*해설\s*[ㆍ·•]\s*(.+?)(?:\d+$)/s);
    if (analysisMatch) data.분석결과해설 = analysisMatch[1].trim();
  }

  // Page 5: 매출 추이 데이터
  if (pages[4]) {
    const p5 = pages[4];
    const trendMatch = p5.match(/선택영역매출\s*([\d]+(?:[\d]+)*)/);
    if (trendMatch) {
      // Extract individual numbers from concatenated string
      // The monthly values are typically 3-digit numbers
      const numStr = trendMatch[1];
      const values = [];
      // Try to extract 13 months of data (3-digit each)
      for (let i = 0; i < numStr.length; i += 3) {
        const val = numStr.substring(i, i + 3);
        if (val.length === 3 && parseInt(val) > 0) values.push(parseInt(val));
        else break;
      }
      if (values.length >= 6) {
        data.매출추이 = values;
        // Recent 3 months average
        const recent3 = values.slice(-3);
        data.최근3개월평균매출 = Math.round(recent3.reduce((a, b) => a + b, 0) / recent3.length);
      }
    }
  }

  // Page 7: 매출 특성 (주중/주말)
  if (pages[6]) {
    const p7 = pages[6];
    // 요일별 매출 비율: "비율 41.4 58.6 9.0 7.4 17.5 21.2 9.5 23.8 11.6"
    const ratioMatch = p7.match(/선택\s*영역매출액\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)/);
    if (ratioMatch) {
      data.주중매출 = ratioMatch[1] + '만원';
      data.주말매출 = ratioMatch[2] + '만원';
    }
    const dayRatioMatch = p7.match(/비율\s*([\d.]+)\s*([\d.]+)\s*([\d.]+)\s*([\d.]+)\s*([\d.]+)\s*([\d.]+)\s*([\d.]+)\s*([\d.]+)\s*([\d.]+)/);
    if (dayRatioMatch) {
      data.주중비율 = dayRatioMatch[1] + '%';
      data.주말비율 = dayRatioMatch[2] + '%';
      data.요일별매출비율 = { 월: dayRatioMatch[3], 화: dayRatioMatch[4], 수: dayRatioMatch[5], 목: dayRatioMatch[6], 금: dayRatioMatch[7], 토: dayRatioMatch[8], 일: dayRatioMatch[9] };
    }
  }

  // Page 8-9: 유동인구
  if (pages[8]) {
    const p9 = pages[8];
    const floatMatch = p9.match(/선택영역인구\s*([\d,]+)\s*([\d,]+)/);
    if (floatMatch) {
      data.유동인구_주중 = floatMatch[1].replace(/,/g, '');
      data.유동인구_주말 = floatMatch[2].replace(/,/g, '');
    }
  }

  // Page 10: 주거인구
  if (pages[9]) {
    const p10 = pages[9];
    const popMatch = p10.match(/선택\s*영역\s*([\d,]+)\s*([\d,]+)\s*([\d,]+)\s*감천/);
    if (popMatch) {
      data.주거인구 = { '2024하반기': popMatch[1].replace(/,/g, ''), '2025상반기': popMatch[2].replace(/,/g, ''), '2025하반기': popMatch[3].replace(/,/g, '') };
    }
  }

  // Page 11: 소득/소비
  if (pages[10]) {
    const p11 = pages[10];
    const incomeMatch = p11.match(/감천\s*1\s*동\s*(\d+)\s*~\s*(\d+)\s*(\d+)\s*~\s*(\d+)\s*(\d+)\s*~\s*(\d+)\s*(\d+)\s*~\s*(\d+)/);
    if (incomeMatch) {
      data.주거인구_소득 = incomeMatch[1] + '~' + incomeMatch[2] + '만원';
      data.주거인구_소비 = incomeMatch[5] + '~' + incomeMatch[6] + '만원';
    }
  }

  // Page 6: 매출건수
  if (pages[5]) {
    const p6 = pages[5];
    const countMatch = p6.match(/선택영역매출\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)/);
    if (countMatch) {
      data.매출건수추이 = [];
      for (let i = 1; i <= 13; i++) data.매출건수추이.push(parseInt(countMatch[i]));
    }
  }

  // Page 13: 직장인구
  if (pages[12]) {
    const p13 = pages[12];
    const workMatch = p13.match(/선택\s*영역\s*([\d,]+)\s*([\d,]+)\s*([\d,]+)\s*감천/);
    if (workMatch) {
      data.직장인구_최근 = workMatch[3].replace(/,/g, '');
    }
  }

  return data;
}

// ===== OCR 기반 PDF 파싱 (이미지 스캔 PDF용) =====

async function parsePDFWithOCR(filepath) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { createCanvas } = require('canvas');
  const { createWorker } = require('tesseract.js');
  const fs = require('fs');

  const data = new Uint8Array(fs.readFileSync(filepath));
  const doc = await getDocument({ data }).promise;

  // Check if text-based first
  const firstPage = await doc.getPage(1);
  const content = await firstPage.getTextContent();
  if (content.items.length > 10) {
    // Text-based PDF - use regular parser
    return parsePDF(filepath);
  }

  // Image-based PDF - use OCR
  const worker = await createWorker('kor');
  const pages = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 2.0 });
    const canvas = createCanvas(vp.width, vp.height);
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const buf = canvas.toBuffer('image/png');
    const { data: { text } } = await worker.recognize(buf);
    pages.push(text);
  }

  await worker.terminate();
  return pages;
}

// ===== 행복드림센터 신청서 파싱 (OCR 텍스트 기반) =====

function extract행복드림신청서(pages) {
  const text = pages.join('\n\n');
  const data = {};

  // 대표자명/신청인 - Page 3 "친청민(대표자) 정혜영" 패턴 우선
  const namePatterns = [
    /[친신]청[인민]\s*\(\s*대표자\s*\)\s*(\S{2,4})/,
    /신청[인민]\s*[(:（]?\s*대표자\s*[):）]?\s*(\S{2,4})/,
    /대표자[명]?\s+(\S{2,4})\s/
  ];
  for (const p of namePatterns) {
    const m = text.match(p);
    if (m && /[\uAC00-\uD7AF]{2,}/.test(m[1])) { data.고객명 = cleanOCR(m[1]); break; }
  }

  // 업체명 - "사업장명 헤어혜르티" 패턴 우선 (Page 3)
  const bizPatterns = [
    /사업장명\s+(\S+)/,
    /[업렴][체쳬]명\s*[.|:ㅣ]?\s*(\S+)/
  ];
  for (const p of bizPatterns) {
    const m = text.match(p);
    if (m && /[\uAC00-\uD7AF]{2,}/.test(m[1])) { data.업체명 = cleanOCR(m[1]); break; }
  }

  // 성별
  const genderMatch = text.match(/성별\s+(\S+)/);
  if (genderMatch) data.성별 = genderMatch[1].includes('여') ? '여' : '남';

  // 생년월일
  const birthMatch = text.match(/생년월일\s+(\d{4}[\-\.]\d{2}[\-\.]\d{2})/);
  if (birthMatch) {
    data.생년월일 = birthMatch[1];
    data.연령 = new Date().getFullYear() - parseInt(birthMatch[1].substring(0, 4));
  }

  // 사업단계
  const stageMatch = text.match(/사업단계\s+(기존\s*사업자|예비\s*창업자|창업)/);
  if (stageMatch) data.사업현황 = stageMatch[1].replace(/\s/g, '');

  // 사업자등록번호
  const regMatch = text.match(/사[업입][자]?등록번호\s*[|ㅣ]?\s*([\d\-]+)/);
  if (regMatch) data.사업자등록번호 = regMatch[1];

  // 주소
  const addrMatch = text.match(/(\d{5})\s*[,.]?\s*((?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충[북남]|전[북남]|경[북남]|제주)\S+[^\n]{5,50})/);
  if (addrMatch) data.사업장주소 = addrMatch[1] + ' ' + addrMatch[2].trim();

  // 개업일
  const dateMatch = text.match(/개업일\s*[|ㅣ]?\s*(\d{4}[.\-]\d{2}[.\-]\d{2})/);
  if (dateMatch) data.창업일자 = dateMatch[1];

  // 종업원수
  const empMatch = text.match(/종업원\s*수?\s*[|ㅣ(]?\s*(?:상시종사자|고용인원)?\s*[)ㅣ]?\s*(\d+)\s*[)명]/);
  if (empMatch) data.종업원수 = empMatch[1];
  if (!data.종업원수) {
    const emp2 = text.match(/종업원\s*[:：]?\s*없음/);
    if (emp2) data.종업원수 = '0';
  }

  // 매출
  const salesMatch = text.match(/매출[액]?\s*[:(（]?\s*(?:월|평균)?\s*[):）]?\s*(?:.*?)\s*(\d+)\s*만원/);
  if (salesMatch) data.월매출액 = salesMatch[1];
  if (!data.월매출액) {
    const sm2 = text.match(/매출\s*[:：]?\s*월?\s*(\d+)\s*[~\-]?\s*\d*\s*백?만/);
    if (sm2) data.월매출액 = sm2[1].length <= 2 ? String(parseInt(sm2[1]) * 100) : sm2[1];
  }
  // "월7~8백만원" 패턴
  if (!data.월매출액) {
    const sm3 = text.match(/월\s*(\d+)\s*[~\-]\s*(\d+)\s*백만원/);
    if (sm3) data.월매출액 = String(Math.round((parseInt(sm3[1]) + parseInt(sm3[2])) / 2 * 100));
  }

  // 월세 - 여러 패턴
  const rentPatterns = [
    /월세[금액]?\s*(\d+)\s*만원/,
    /월세금액\s*(\d+)\s*만/,
    /월세\s*[:：]?\s*(\d+)\s*만/,
    /[/\/]\s*(\d+)\s*만원\s*$/m  // "3천만원/80만원" 패턴에서 뒤쪽
  ];
  for (const p of rentPatterns) {
    const m = text.match(p);
    if (m) { data.월세 = m[1]; break; }
  }

  // 보증금
  const depMatch = text.match(/(?:임차)?보증금[액]?\s*(\d+)\s*(?:백만|만)/);
  if (depMatch) {
    const val = parseInt(depMatch[1]);
    data.보증금 = depMatch[0].includes('백만') ? String(val * 100) : String(val);
  }

  // 연락처
  const phoneMatch = text.match(/(?:휴대폰|핸드폰|연락처|전화)\s*[|ㅣ]?\s*(01[0-9][\-\s]?\d{3,4}[\-\s]?\d{4})/);
  if (phoneMatch) data.연락처 = phoneMatch[1].replace(/\s/g, '');

  // 업종
  const typeMatch = text.match(/이\s*[·']?\s*미용|미용[실업]|헤어/);
  if (typeMatch) data.업종 = '이·미용';
  if (!data.업종) {
    const t2 = text.match(/음식[업점]|카페|커피|분식/);
    if (t2) data.업종 = '음식업';
  }
  if (!data.업종) {
    const t3 = text.match(/도소매|의류|소매/);
    if (t3) data.업종 = '도소매';
  }

  // 경력 (예비진단 영역)
  const expMatch = text.match(/경력\s*[:：]?\s*(.+?)(?:\n|$)/);
  if (expMatch) data.경력메모 = expMatch[1].trim();

  // 컨설팅 요청사항/분야
  const reqMatch = text.match(/(?:컨설팅\s*분야|요청사항)\s*[|ㅣ:：]?\s*(.+?)(?:\n|$)/);
  if (reqMatch) data.요청사항 = cleanOCR(reqMatch[1]);

  // 임차 정보
  if (text.includes('임차')) data.임차구분 = '임차';

  return data;
}

function cleanOCR(str) {
  return str.replace(/[|ㅣ_\-=]/g, '').replace(/\s+/g, ' ').trim();
}

module.exports = { parsePDF, parsePDFWithOCR, extract신청서, extract행복드림신청서, extract상권리포트, normalizeKoreanSpaces };
