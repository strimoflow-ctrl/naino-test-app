import express from 'express';
import fs from 'fs';
import path from 'path';
import { NOTES_DIR, DOWNLOADS_DIR } from '../db.js';

const router = express.Router();

// NEET Standard NCERT Chapter Mappings
const PHYSICS_CHAPTERS = {
  1: "Units & Measurements",
  2: "Motion in a Straight Line",
  3: "Motion in a Plane",
  4: "Laws of Motion",
  5: "Work, Energy & Power",
  6: "Rotational Motion & Particles",
  7: "Gravitation",
  8: "Mechanical Properties of Solids",
  9: "Mechanical Properties of Fluids",
  10: "Thermal Properties of Matter",
  11: "Thermodynamics",
  12: "Kinetic Theory of Gases",
  13: "Oscillations",
  14: "Waves",
  15: "Electric Charges & Fields",
  16: "Electrostatic Potential & Capacitance",
  17: "Current Electricity",
  18: "Moving Charges & Magnetism",
  19: "Magnetism & Matter",
  20: "Electromagnetic Induction",
  21: "Alternating Current",
  22: "Electromagnetic Waves",
  23: "Ray Optics & Optical Instruments",
  24: "Wave Optics",
  25: "Dual Nature of Radiation & Matter",
  26: "Atoms",
  27: "Nuclei",
  28: "Semiconductor Electronics",
  29: "Communication Systems",
  30: "Experimental & Practical Physics",
  31: "Summary & Formulas"
};

const CHEMISTRY_CHAPTERS = {
  1: "Some Basic Concepts of Chemistry",
  2: "Structure of Atom",
  3: "Classification of Elements & Periodicity",
  4: "Chemical Bonding & Molecular Structure",
  5: "States of Matter",
  6: "Chemical Thermodynamics",
  7: "Equilibrium (Physical & Chemical)",
  8: "Redox Reactions",
  9: "Hydrogen",
  10: "s-Block Elements (Alkali & Alkaline)",
  11: "p-Block Elements (Group 13 & 14)",
  12: "Organic Chemistry: Basics & Mechanisms",
  13: "Hydrocarbons",
  14: "Environmental Chemistry",
  15: "Solid State",
  16: "Solutions",
  17: "Electrochemistry",
  18: "Chemical Kinetics",
  19: "Surface Chemistry",
  20: "Metallurgy: Isolation of Elements",
  21: "p-Block Elements (Group 15 to 18)",
  22: "d and f-Block Elements",
  23: "Coordination Compounds",
  24: "Haloalkanes & Haloarenes",
  25: "Alcohols, Phenols & Ethers",
  26: "Aldehydes, Ketones & Carboxylic Acids",
  27: "Amines & Nitrogen Compounds",
  28: "Biomolecules",
  29: "Polymers",
  30: "Chemistry in Everyday Life",
  31: "Practical & Analytical Chemistry",
  32: "Nuclear Chemistry"
};

const BIOLOGY_CHAPTERS = {
  1: "The Living World",
  2: "Biological Classification",
  3: "Plant Kingdom",
  4: "Animal Kingdom",
  5: "Morphology of Flowering Plants",
  6: "Anatomy of Flowering Plants",
  7: "Structural Organisation in Animals",
  8: "Cell: The Unit of Life",
  9: "Biomolecules",
  10: "Cell Cycle & Cell Division",
  11: "Transport in Plants",
  12: "Mineral Nutrition",
  13: "Photosynthesis in Higher Plants",
  14: "Respiration in Plants",
  15: "Plant Growth & Development",
  16: "Digestion & Absorption",
  17: "Breathing & Exchange of Gases",
  18: "Body Fluids & Circulation",
  19: "Excretory Products & Elimination",
  20: "Locomotion & Movement",
  21: "Neural Control & Coordination",
  22: "Chemical Coordination & Integration",
  23: "Reproduction in Organisms",
  24: "Sexual Reproduction in Flowering Plants",
  25: "Human Reproduction",
  26: "Reproductive Health",
  27: "Principles of Inheritance & Variation",
  28: "Molecular Basis of Inheritance",
  29: "Evolution",
  30: "Human Health & Disease",
  31: "Strategies for Enhancement in Food",
  32: "Microbes in Human Welfare",
  33: "Biotechnology: Principles & Processes",
  34: "Biotechnology & its Applications",
  35: "Organisms & Populations",
  36: "Ecosystem",
  37: "Biodiversity & Conservation",
  38: "Environmental Issues",
  39: "Applied Genetics & Pedigree",
  40: "Cytology & Organelles",
  41: "Plant Physiology Master Notes",
  42: "Human Physiology Master Notes",
  43: "Ecology & Wildlife",
  44: "Immunology & Diseases",
  45: "Reproductive Biology Summary",
  46: "Genomics & Bio-patents",
  47: "Medical Microbiology",
  48: "Comprehensive NEET Biology"
};

// Official NEET NCERT Botany & Zoology Classification
const BOTANY_CHAPTERS = new Set([
  1, 2, 3, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15,
  23, 24, 27, 28, 31, 32, 35, 36, 37, 38,
  39, 40, 41, 43, 47, 48
]);

const ZOOLOGY_CHAPTERS = new Set([
  4, 7, 9, 16, 17, 18, 19, 20, 21, 22,
  25, 26, 29, 30, 33, 34,
  42, 44, 45, 46, 48
]);

function parseBookMetadata(fileName) {
  const match = fileName.match(/^([a-zA-Z]+?)(\d+)?\.pdf$/);
  if (!match) {
    return {
      category: "Other Books",
      subject: "General",
      chapterNum: 0,
      chapterName: fileName.replace('.pdf', ''),
      title: fileName.replace('.pdf', '')
    };
  }

  const prefix = match[1].toLowerCase();
  const chapterNum = match[2] ? parseInt(match[2]) : 1;

  let category = "NCERT Textbooks";
  let subject = "Biology";

  if (prefix.includes('phy')) subject = "Physics";
  else if (prefix.includes('che')) subject = "Chemistry";
  else if (prefix.includes('bio')) subject = "Biology";

  if (prefix.startsWith('ncertshortnote')) category = "NCERT Short Notes";
  else if (prefix.startsWith('ncertbook')) category = "NCERT Textbooks";
  else if (prefix.startsWith('formula')) category = "Formula Books";
  else if (prefix.startsWith('mindmap')) category = "Mindmaps";
  else if (prefix.startsWith('topernote')) category = "Toppers Notes";
  else if (prefix.startsWith('flashcard')) category = "Flashcards";
  else if (prefix.startsWith('errorless')) category = "Errorless NEET Books";
  else if (prefix.startsWith('optondon')) category = "OP Tandon Chemistry";
  else if (prefix.startsWith('slb')) category = "NEET Syllabus";
  else if (prefix.startsWith('ncertsolution')) category = "NCERT Solutions";

  let chapterName = `Chapter ${chapterNum}`;
  if (subject === "Physics") {
    chapterName = PHYSICS_CHAPTERS[chapterNum] || `Physics Topic ${chapterNum}`;
  } else if (subject === "Chemistry") {
    chapterName = CHEMISTRY_CHAPTERS[chapterNum] || `Chemistry Topic ${chapterNum}`;
  } else if (subject === "Biology") {
    chapterName = BIOLOGY_CHAPTERS[chapterNum] || `Biology Topic ${chapterNum}`;
  }

  return {
    category,
    subject,
    chapterNum,
    chapterName,
    title: `Chapter ${chapterNum}: ${chapterName}`
  };
}

// 1. 79 HTML Study Notes List
router.get('/notes', (req, res) => {
  if (!fs.existsSync(NOTES_DIR)) {
    return res.json({ totalNotes: 0, notes: [] });
  }

  const requestedSubject = req.query.subject;
  const subjects = ['botany', 'chemistry', 'physics', 'zoology'];
  const notesList = [];
  const subjectCounts = {};

  for (const sub of subjects) {
    const subName = sub.charAt(0).toUpperCase() + sub.slice(1);
    const subPath = path.join(NOTES_DIR, sub);
    let count = 0;
    if (fs.existsSync(subPath)) {
      const files = fs.readdirSync(subPath).filter(f => f.endsWith('.html'));
      count = files.length;
      if (!requestedSubject || requestedSubject.toLowerCase() === sub.toLowerCase()) {
        for (const f of files) {
          const rawTitle = f.replace('.html', '').replace(/_/g, ' ');
          const formattedTitle = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1);
          notesList.push({
            title: formattedTitle,
            fileName: f,
            subject: subName,
            url: `/api/notes/${sub}/${f}`
          });
        }
      }
    }
    if (count > 0) {
      subjectCounts[subName] = count;
    }
  }

  res.json({ totalNotes: notesList.length, subjectCounts, notes: notesList });
});

// 2. Single HTML Note Content
router.get('/notes/:subject/:fileName', (req, res) => {
  const { subject, fileName } = req.params;
  const filePath = path.join(NOTES_DIR, subject.toLowerCase(), fileName);

  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'text/html');
    res.send(fs.readFileSync(filePath, 'utf-8'));
  } else {
    res.status(404).send('Study Note Not Found');
  }
});

// 3. Study Library (605 PDFs Catalog with Subject & Chapter Breakdowns)
router.get('/library/books', (req, res) => {
  const pdfDir = path.join(DOWNLOADS_DIR, 'pdfs');
  const manifestPaths = [
    path.join(process.cwd(), 'cloud_manifest.json'),
    path.join(process.cwd(), 'data', 'cloud_manifest.json'),
    path.join(DOWNLOADS_DIR, '..', 'cloud_manifest.json')
  ];
  const manifestPath = manifestPaths.find(p => fs.existsSync(p)) || manifestPaths[0];
  
  let manifest = {};
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (_) {}
  }

  const localFiles = fs.existsSync(pdfDir) ? fs.readdirSync(pdfDir).filter(f => f.endsWith('.pdf')) : [];
  const manifestFiles = Object.keys(manifest).filter(f => f.endsWith('.pdf'));
  const allFileNames = Array.from(new Set([...localFiles, ...manifestFiles]));

  if (allFileNames.length === 0) {
    return res.json({ totalPdfs: 0, categories: {}, byCategoryAndSubject: {} });
  }

  const filterCat = req.query.category;
  const filterSub = req.query.subject;
  const baseUrl = process.env.R2_PUBLIC_URL || `${req.protocol}://${req.get('host')}/media/pdfs`;

  // Structured by Category -> Subject -> Sorted Chapters
  const byCategoryAndSubject = {};
  const flatCategories = {};

  for (const f of allFileNames) {
    const meta = parseBookMetadata(f);
    const cat = meta.category;
    const sub = meta.subject;

    if (!byCategoryAndSubject[cat]) byCategoryAndSubject[cat] = {};
    if (!byCategoryAndSubject[cat][sub]) byCategoryAndSubject[cat][sub] = [];
    if (!flatCategories[cat]) flatCategories[cat] = [];

    const r2Entry = manifest[f];
    let sizeMB = '2.5';
    if (r2Entry && r2Entry.size_bytes) {
      sizeMB = (r2Entry.size_bytes / (1024 * 1024)).toFixed(2);
    } else {
      try {
        const localPath = path.join(pdfDir, f);
        if (fs.existsSync(localPath)) {
          sizeMB = (fs.statSync(localPath).size / (1024 * 1024)).toFixed(2);
        }
      } catch (_) {}
    }

    const downloadUrl = (r2Entry && r2Entry.r2_url) ? r2Entry.r2_url : `${baseUrl}/${f}`;

    const bookEntry = {
      fileName: f,
      title: meta.title,
      chapterNum: meta.chapterNum,
      chapterName: meta.chapterName,
      subject: meta.subject,
      category: meta.category,
      sizeMB: `${sizeMB} MB`,
      downloadUrl: downloadUrl
    };

    byCategoryAndSubject[cat][sub].push(bookEntry);
    flatCategories[cat].push(bookEntry);

    // Intelligently map Biology books into Botany and Zoology as well!
    if (sub === 'Biology') {
      if (cat === 'NEET Syllabus') {
        if (!byCategoryAndSubject[cat]['Botany']) byCategoryAndSubject[cat]['Botany'] = [];
        if (!byCategoryAndSubject[cat]['Zoology']) byCategoryAndSubject[cat]['Zoology'] = [];
        byCategoryAndSubject[cat]['Botany'].push({ ...bookEntry, subject: 'Botany' });
        byCategoryAndSubject[cat]['Zoology'].push({ ...bookEntry, subject: 'Zoology' });
      } else {
        if (BOTANY_CHAPTERS.has(meta.chapterNum)) {
          if (!byCategoryAndSubject[cat]['Botany']) byCategoryAndSubject[cat]['Botany'] = [];
          byCategoryAndSubject[cat]['Botany'].push({ ...bookEntry, subject: 'Botany' });
        }
        if (ZOOLOGY_CHAPTERS.has(meta.chapterNum)) {
          if (!byCategoryAndSubject[cat]['Zoology']) byCategoryAndSubject[cat]['Zoology'] = [];
          byCategoryAndSubject[cat]['Zoology'].push({ ...bookEntry, subject: 'Zoology' });
        }
      }
    }
  }

  // Sort each subject list numerically by chapterNum
  for (const cat of Object.keys(byCategoryAndSubject)) {
    for (const sub of Object.keys(byCategoryAndSubject[cat])) {
      byCategoryAndSubject[cat][sub].sort((a, b) => a.chapterNum - b.chapterNum);
    }
    flatCategories[cat].sort((a, b) => a.chapterNum - b.chapterNum);
  }

  // If specific category requested
  if (filterCat) {
    const matchedCat = Object.keys(byCategoryAndSubject).find(
      c => c.toLowerCase().replace(/\s+/g, '') === filterCat.toLowerCase().replace(/\s+/g, '')
    ) || filterCat;
    const subDict = byCategoryAndSubject[matchedCat] || {};

    // Specific subject requested
    if (filterSub) {
      const matchedSub = Object.keys(subDict).find(
        s => s.toLowerCase() === filterSub.toLowerCase()
      ) || filterSub;
      const subList = subDict[matchedSub] || [];
      return res.json({
        category: matchedCat,
        subject: matchedSub,
        total: subList.length,
        books: subList
      });
    }

    // Only return subjects that actually have books with live counts!
    const availableSubjects = {};
    for (const [sub, list] of Object.entries(subDict)) {
      if (list && list.length > 0) {
        availableSubjects[sub] = list.length;
      }
    }

    return res.json({
      category: matchedCat,
      subjects: availableSubjects,
      bySubject: subDict
    });
  }

  res.json({
    totalPdfs: allFileNames.length,
    byCategoryAndSubject,
    categories: flatCategories
  });
});

export default router;
