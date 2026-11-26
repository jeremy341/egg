# Deploy on release

`deploy-on-release.yml` starts a deployment when you publish a GitHub release. Copy it to `.github/workflows/` in your repository.

**Token scopes:** none. It uses the project's deploy hook, a secret URL. Create the hook in the project's settings (the URL is shown once) and save it as the repository secret `EGG_HOOK`. Replacing the hook in Egg makes the old URL stop working.

The workflow never prints the URL, and a failed call (for example 409 while another deployment runs) fails the job.
