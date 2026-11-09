import express from 'express';
import { getMongoDb } from '../db.js';

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

// In-memory cache for fetched HTML notes (TTL: 1 hour)
const notesHtmlCache = new Map();

// 1. 79 HTML Study Notes List (100% Cloudflare R2 + MongoDB Atlas driven)
router.get('/notes', async (req, res) => {
  const requestedSubject = req.query.subject;
  const db = getMongoDb();

  try {
    if (db) {
      const query = {};
      if (requestedSubject) {
        query.subject = { $regex: new RegExp(`^${requestedSubject}$`, 'i') };
      }
      const docs = await db.collection('study_notes').find(query).toArray();
      if (docs && docs.length > 0) {
        const notesList = docs.map(d => ({
          title: d.title || d.fileName.replace('.html', '').replace(/_/g, ' '),
          fileName: d.fileName,
          subject: d.subject,
          r2_url: d.r2_url,
          url: `/api/notes/${(d.subject || 'general').toLowerCase()}/${d.fileName}`
        }));

        const subjectCounts = {};
        for (const n of notesList) {
          subjectCounts[n.subject] = (subjectCounts[n.subject] || 0) + 1;
        }

        return res.json({ totalNotes: notesList.length, subjectCounts, notes: notesList });
      }
    }
  } catch (err) {
    console.warn('[Library] MongoDB study_notes query warning:', err.message);
  }

  return res.json({ totalNotes: 0, notes: [] });
});

// 2. Single HTML Note Content (Streamed directly from Cloudflare R2 / RAM Cache)
router.get('/notes/:subject/:fileName', async (req, res) => {
  const { subject, fileName } = req.params;
  const cacheKey = `${subject.toLowerCase()}_${fileName}`;

  // Check in-memory cache
  if (notesHtmlCache.has(cacheKey)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(notesHtmlCache.get(cacheKey));
  }

  // Try MongoDB + Cloudflare R2
  try {
    const db = getMongoDb();
    let r2Url = `https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/notes/${subject.toLowerCase()}/${fileName}`;
    if (db) {
      const noteDoc = await db.collection('study_notes').findOne({
        $or: [
          { fileName },
          { fileName: fileName.toLowerCase() },
          { _id: `note_${subject.toLowerCase()}_${fileName.replace('.html', '')}` }
        ]
      });
      if (noteDoc?.r2_url) {
        r2Url = noteDoc.r2_url;
      }
    }

    const r2Resp = await fetch(r2Url);
    if (r2Resp.ok) {
      const html = await r2Resp.text();
      notesHtmlCache.set(cacheKey, html);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }
  } catch (err) {
    console.warn('[Library] Failed to fetch note from R2:', err.message);
  }

  res.status(404).send('Study Note Not Found');
});

// 3. Study Library Catalog (100% MongoDB Atlas + Cloudflare R2 driven)
router.get('/library/books', async (req, res) => {
  const filterCat = req.query.category;
  const filterSub = req.query.subject;
  const defaultR2Base = process.env.R2_PUBLIC_URL || 'https://pub-47ed3d1499e74513acc2f956e489e661.r2.dev/pdfs';

  let materials = [];
  try {
    const db = getMongoDb();
    if (db) {
      materials = await db.collection('study_materials').find({ is_active: { $ne: false } }).toArray();
    }
  } catch (err) {
    console.warn('[Library] MongoDB study_materials query failed:', err.message);
  }

  if (!materials || materials.length === 0) {
    return res.json({ totalPdfs: 0, categories: {}, byCategoryAndSubject: {} });
  }

  // Structured by Category -> Subject -> Sorted Chapters
  const byCategoryAndSubject = {};
  const flatCategories = {};

  for (const doc of materials) {
    const filename = doc.filename || `${doc.material_id}.pdf`;
    const meta = parseBookMetadata(filename);
    const cat = doc.category || meta.category;
    const sub = doc.subject || meta.subject;

    if (!byCategoryAndSubject[cat]) byCategoryAndSubject[cat] = {};
    if (!byCategoryAndSubject[cat][sub]) byCategoryAndSubject[cat][sub] = [];
    if (!flatCategories[cat]) flatCategories[cat] = [];

    const sizeBytes = doc.size_bytes || 2600000;
    const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(2);
    const downloadUrl = doc.r2_url || `${defaultR2Base}/${filename}`;

    const bookEntry = {
      material_id: doc.material_id || doc._id?.toString(),
      fileName: filename,
      title: doc.title || meta.title,
      chapterNum: doc.chapterNum || meta.chapterNum,
      chapterName: doc.chapterName || meta.chapterName,
      subject: sub,
      category: cat,
      sizeMB: `${sizeMB} MB`,
      downloadUrl: downloadUrl
    };

    byCategoryAndSubject[cat][sub].push(bookEntry);
    flatCategories[cat].push(bookEntry);

    // Intelligently map Biology books into Botany and Zoology
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
    totalPdfs: materials.length,
    byCategoryAndSubject,
    categories: flatCategories
  });
});

export { parseBookMetadata };
export default router;
