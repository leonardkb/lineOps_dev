// Standalone test — run this against your real AWS credentials to confirm
// the zero-dependency S3 signing works before relying on it in the app.
//
// Usage:
//   AWS_REGION=mx-central-1 \
//   AWS_ACCESS_KEY_ID=... \
//   AWS_SECRET_ACCESS_KEY=... \
//   S3_BUCKET_NAME=skyrina-style-photos \
//   node test-s3.js
//
// Or just fill in a .env file in this same folder and run: node test-s3.js

require("dotenv").config();
const { uploadBufferToS3, deleteFromS3, generatePresignedGetUrl } = require("./s3-raw");

(async () => {
  const testKey = `style-photos/_connectivity-test-${Date.now()}.txt`;
  const testContent = Buffer.from("Hello from the zero-dependency S3 test script!");

  console.log("→ Uploading test object:", testKey);
  try {
    await uploadBufferToS3(testContent, testKey, "text/plain");
    console.log("✅ Upload succeeded!");
  } catch (err) {
    console.error("❌ Upload failed:", err.message);
    console.error("\nCommon causes:");
    console.error("  - Wrong AWS_REGION (must match the bucket's actual region)");
    console.error("  - Wrong/expired AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY");
    console.error("  - IAM user's policy doesn't allow s3:PutObject on this bucket");
    console.error("  - S3_BUCKET_NAME doesn't match exactly (case-sensitive)");
    process.exit(1);
  }

  console.log("\n→ Generating a presigned URL (valid 5 minutes)...");
  const signedUrl = generatePresignedGetUrl(testKey, 300);
  console.log("   URL:", signedUrl);
  console.log("   Paste that into a browser tab within the next 5 minutes —");
  console.log("   it should show the test text even though the bucket is private.");
  console.log("   (No need to touch Block Public Access at all for this to work.)");
  console.log("\n   Once you've confirmed it works, delete the test object manually");
  console.log("   from the S3 console (it's under style-photos/ in your bucket),");
  console.log("   or just leave it — it's a few bytes of harmless text.");
})();