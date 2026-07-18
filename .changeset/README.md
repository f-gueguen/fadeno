# Changesets

Every user-visible public-package change adds one Markdown changeset. The file
names the affected package, declares `major`, `minor`, or `patch` intent, and
contains the future changelog text.

Repository-only, documentation-only, and private-evidence changes instead
state why they have no release impact in their pull request.

Do not run versioning or publication commands from a feature branch. A release
slice consumes reviewed changesets mechanically after the exact source commit
passes local qualification.
