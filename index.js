const core = require("@actions/core");
const github = require("@actions/github");
const { execSync } = require("child_process");

async function run() {
  try {
    const token = core.getInput("github-token", { required: true });
    const octokit = github.getOctokit(token);

    const pullRequest = github.context.payload.pull_request;
    const repo = github.context.repo;

    const openPullRequests = await getOpenPullRequests(octokit, repo);
    const otherOpenPullRequests = openPullRequests.filter(
      (pr) => pr.number !== pullRequest.number
    );

    let conflictArray = [];

    for (const openPullRequest of otherOpenPullRequests) {
      const conflictFiles = checkForConflicts({
        octokit,
        repo,
        pr1Number: pullRequest.number,
        pr2Number: openPullRequest.number,
      });

      console.log('conflictFiles', conflictFiles)
      if (conflictFiles) {
        conflictArray.push({
          number: openPullRequest.number,
          user: openPullRequest.user.login,
          conflictFiles,
        });
      }
    }

    if (conflictArray.length > 0) {
      console.log('conflictArray', conflictArray)
      await createConflictComment({
        octokit,
        repo,
        prNumber: pullRequest.number,
        conflictArray,
      });
      await requestReviews({
        octokit,
        repo,
        prNumber: pullRequest.number,
        conflictArray,
        prAuthor: pullRequest.user.login,
      });
      await requestReviewsInConflictingPRs({
        octokit,
        repo,
        conflictArray,
        prAuthor: pullRequest.user.login,
      });
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

async function getOpenPullRequests(octokit, repo) {
  try {
    const { data: pullRequests } = await octokit.rest.pulls.list({
      owner: repo.owner,
      repo: repo.repo,
      state: "open",
      per_page: 100,
    });

    // Map the list to only contain relevant information (PR number and author)
    const openPullRequests = pullRequests.map((pr) => ({
      number: pr.number,
      user: pr.user,
    }));

    return openPullRequests;
  } catch (error) {
    console.error(`Error fetching open pull requests: ${error.message}`);
    throw error;
  }
}

async function checkForConflicts({ octokit, repo, pr1Number, pr2Number }) {
  const pr1Branch = await getBranchName(octokit, repo, pr1Number);
  const pr2Branch = await getBranchName(octokit, repo, pr2Number);

  if (!pr1Branch || !pr2Branch) {
    throw new Error("Failed to fetch branch name for one or both PRs.");
  }

  const pr1Files = await getChangedFiles(octokit, repo, pr1Number);
  const pr2Files = await getChangedFiles(octokit, repo, pr2Number);

  const overlappingFiles = pr1Files.filter((file) => pr2Files.includes(file));

  if (!overlappingFiles.length) {
    return [];
  }

  const conflictFiles = await attemptMerge(pr1Branch, pr2Branch);

  return conflictFiles;
}

async function getBranchName(octokit, repo, prNumber) {
  const { data: pr } = await octokit.rest.pulls.get({
    owner: repo.owner,
    repo: repo.repo,
    pull_number: prNumber,
  });

  return pr.head.ref;
}

async function getChangedFiles(octokit, repo, prNumber) {
  const { data: files } = await octokit.rest.pulls.listFiles({
    owner: repo.owner,
    repo: repo.repo,
    pull_number: prNumber,
  });

  return files.map((file) => file.filename);
}

async function attemptMerge(pr1, pr2) {
  let conflictFiles = [];
  let hasConflict = false;

  try {
    // Checkout PR1's branch
    execSync(`git checkout ${pr1}`);

    // Attempt to merge PR2's branch
    execSync(`git merge ${pr2} --no-commit --no-ff`);
  } catch (error) {
    // Check for merge conflict message in the error
    if (error.message.includes("Automatic merge failed")) {
      hasConflict = true;
      // Extract names of files with conflicts. The `git diff` command lists files with conflicts
      const output = execSync(
        "git diff --name-only --diff-filter=U"
      ).toString();
      conflictFiles = output.split("\n").filter(Boolean); // Convert string output to an array and filter out any empty strings
    }
  } finally {
    // Only abort if there was a merge conflict detected
    if (hasConflict) {
      execSync("git merge --abort");
    }
  }

  return conflictFiles;
}


async function createConflictComment({
  octokit,
  repo,
  prNumber,
  conflictArray,
}) {
  try {
    let conflictMessage = "### Conflicts Found\n\n";

    conflictArray.forEach((conflict) => {
      conflictMessage += `<details>\n`;
      conflictMessage += `  <summary><strong>Author:</strong> @${conflict.user} - <strong>PR:</strong> #${conflict.number}</summary>\n`;
      conflict.conflictFiles.forEach((fileName) => {
        conflictMessage += `  <span><strong>${fileName}</span><br />`;
      });
      conflictMessage += `</details>\n\n`;
    });

    await octokit.rest.issues.createComment({
      owner: repo.owner,
      repo: repo.repo,
      issue_number: prNumber,
      body: conflictMessage,
    });
  } catch (error) {
    console.error(`Error creating conflict comment: ${error.message}`);
    throw error;
  }
}

async function requestReviews({
  octokit,
  repo,
  prNumber,
  conflictArray,
  prAuthor,
}) {
  try {
    const reviewers = [
      ...new Set(
        conflictArray
          .map((conflict) => conflict.user)
          .filter((user) => user !== prAuthor)
      ),
    ];

    await octokit.rest.pulls.requestReviewers({
      owner: repo.owner,
      repo: repo.repo,
      pull_number: prNumber,
      reviewers: reviewers,
    });
  } catch (error) {
    console.error(`Error requesting reviews: ${error.message}`);
    throw error;
  }
}

async function requestReviewsInConflictingPRs({
  octokit,
  repo,
  conflictArray,
  prAuthor,
}) {
  try {
    for (const conflict of conflictArray) {
      if (conflict.user !== prAuthor) {
        // Request a review from the current PR author in each conflicting PR
        await octokit.rest.pulls.requestReviewers({
          owner: repo.owner,
          repo: repo.repo,
          pull_number: conflict.number,
          reviewers: [prAuthor],
        });
      }
    }
  } catch (error) {
    console.error(
      `Error requesting reviews in conflicting PRs: ${error.message}`
    );
    throw error;
  }
}

run();
