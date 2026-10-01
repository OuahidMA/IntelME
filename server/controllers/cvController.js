import { asyncHandler } from "../middleware/errorMiddleware.js";
import {
  ALLOWED_EXTENSIONS,
  getExtension,
  MAX_FILE_SIZE_MB,
  removeStoredFile,
} from "../middleware/uploadMiddleware.js";
import { buildAnalysis, buildResumeRecord } from "../services/documentService.js";
import { EXTRACTION_METHOD, extractResumeText, ExtractionError } from "../services/ocrService.js";
import { ValidationError, validateLabel } from "../utils/validators.js";

/**
 * POST /api/resumes/analyse
 *
 * Multipart upload of a .pdf or .docx. Recovers its text (falling back to OCR),
 * runs the AI analysis and returns both — and stores neither.
 *
 * The file itself is deleted in a `finally`, so it exists on the server's disk
 * for exactly as long as it takes to parse it. That is the one moment the CV is
 * anywhere but the user's machine, and there is no code path that leaves it there:
 * a successful parse, a failed parse and a model that refuses the document all
 * fall through the same cleanup.
 */
export const analyseUpload = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new ValidationError("No file was uploaded. Attach a .pdf or .docx file.");
  }

  const label = validateLabel(req.body?.label);
  const { path: filePath, originalname } = req.file;

  let resume;

  try {
    const { text, method, chars } = await extractResumeText({
      filePath,
      fileType: getExtension(originalname),
    });

    resume = buildResumeRecord({ file: req.file, label, text, method, chars });

    console.info(
      `[doc] ${originalname}: ${chars} chars via ${method} (${method === EXTRACTION_METHOD.OCR ? "OCR" : "text layer"})`,
    );
  } catch (error) {
    // A file we cannot read is useless to the user; stop here rather than handing
    // an empty document to the model.
    if (error instanceof ExtractionError) throw error;
    throw new ExtractionError("The file could not be read. Try exporting a fresh PDF or DOCX.");
  } finally {
    removeStoredFile(filePath);
  }

  try {
    const analysis = await buildAnalysis({ text: resume.extractedText });

    return res.status(201).json({
      success: true,
      message: "Resume analysed.",
      resume,
      analysis,
    });
  } catch (error) {
    // The text was recovered fine, so the version is still worth keeping: the
    // browser can store it and re-run the analysis without re-uploading, and
    // re-uploading is exactly what the user should not have to do.
    return res.status(error.status ?? 502).json({
      success: false,
      message: error.message,
      resume,
      analysis: null,
      canRetry: true,
    });
  }
});

/** GET /api/resumes/limits — what the uploader should accept, from the server. */
export const uploadLimits = asyncHandler(async (_req, res) => {
  res.json({
    success: true,
    allowedExtensions: ALLOWED_EXTENSIONS,
    maxFileSizeBytes: MAX_FILE_SIZE_MB * 1024 * 1024,
    maxFileSizeMb: MAX_FILE_SIZE_MB,
  });
});