/**
 * Loads every server module through the real ESM resolver. Catches syntax
 * errors, bad import paths and circular-dependency mistakes without opening a
 * socket or touching MongoDB.
 */
import "dotenv/config";

const modules = [
  "../config/db.js",
  "../models/User.js",
  "../utils/jwt.js",
  "../utils/validators.js",
  "../utils/dates.js",
  "../middleware/authMiddleware.js",
  "../middleware/errorMiddleware.js",
  "../middleware/uploadMiddleware.js",
  "../services/aiService.js",
  "../services/ocrService.js",
  "../services/documentService.js",
  "../services/scoringService.js",
  "../services/matchingService.js",
  "../controllers/authController.js",
  "../controllers/cvController.js",
  "../controllers/analysisController.js",
  "../controllers/jobController.js",
  "../routes/authRoutes.js",
  "../routes/resumeRoutes.js",
  "../routes/analysisRoutes.js",
  "../routes/jobRoutes.js",
];

let failed = 0;

for (const path of modules) {
  try {
    await import(path);
    console.log(`  ok   ${path}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL ${path}\n       ${error.message}`);
  }
}

console.log(failed === 0 ? "\nAll modules loaded." : `\n${failed} module(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
