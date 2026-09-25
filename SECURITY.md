# Security policy

NavPDF currently develops the 0.2.x release line.
Use the latest release and report problems against the current main branch when possible.
Older development builds do not receive separate security backports.

## Reporting a vulnerability

Use GitHub private vulnerability reporting (this repository's Security tab) for security issues.
Include the affected version, operating system, reproduction steps and the expected security boundary.
Use a synthetic PDF that demonstrates the issue without personal or confidential information.
Do not post exploit details, passwords, signature assets or sensitive documents in public issues.

Reports are reviewed by the repository maintainer; no response-time guarantee is currently offered.
A fix is considered verified only after relevant regression tests and independent saved-output checks pass.

## Security boundaries

PDFs, attachments, extracted text and metadata are untrusted input.
Embedded scripts are disabled, external links require confirmation, and attachments are never launched automatically.
Document processing is local; security reports must not include private user documents.
Encrypted input remains read-only until explicitly unlocked, and decrypted recovery copies must not be written.
Secure redaction must remove underlying content and pass text, object, image and hidden-data checks.
Signature appearances do not provide cryptographic certification.
