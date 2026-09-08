"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const s3 = new client_s3_1.S3Client();
const handler = async (event, context) => {
    try {
        switch (event.RequestType) {
            case "Create": { }
            case "Update": {
                await populateBucket(event.ResourceProperties.BucketName);
                break;
            }
            case "Delete": {
                await emptyBucket(event.ResourceProperties.BucketName);
                break;
            }
        }
        await sendResponse(event, context, "SUCCESS", {});
    }
    catch (err) {
        console.error(err);
        await sendResponse(event, context, "FAILED", {});
    }
};
exports.handler = handler;
async function sendResponse(event, context, status, data) {
    const respondeObject = {
        Status: status,
        Reason: `See CloudWatch log stream: ${context.logStreamName}`,
        PhysicalResourceId: context.logStreamName,
        StackId: event.StackId,
        RequestId: event.RequestId,
        LogicalResourceId: event.LogicalResourceId,
        Data: data,
    };
    const body = JSON.stringify(respondeObject);
    await fetch(event.ResponseURL, {
        method: "PUT",
        body,
    });
}
async function populateBucket(bucketName) {
    const files = await getGitHubRepoFiles({ owner: "antoniocolagreco", repo: "test-files" });
    for (const file of files) {
        await s3.send(new client_s3_1.PutObjectCommand({ Bucket: bucketName, Key: file.name, Body: file.body }));
    }
}
async function emptyBucket(bucketName) {
    let token = undefined;
    do {
        const list = await s3.send(new client_s3_1.ListObjectsV2Command({
            Bucket: bucketName,
            ContinuationToken: token,
        }));
        if (list.Contents?.length) {
            await s3.send(new client_s3_1.DeleteObjectsCommand({
                Bucket: bucketName,
                Delete: { Objects: list.Contents.map(o => ({ Key: o.Key })) },
            }));
        }
        token = list.NextContinuationToken;
    } while (token);
}
function getGitHubUrl({ owner, repo, path = "", branch }) {
    const url = new URL(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`);
    if (branch)
        url.searchParams.set("ref", branch);
    return url.toString();
}
async function getGitHubRepoFiles(params) {
    const url = getGitHubUrl(params);
    const headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "NodeJS-Script",
    };
    if (params.token) {
        headers["Authorization"] = `Bearer ${params.token}`;
    }
    const response = await fetch(url, { headers });
    if (!response.ok) {
        throw new Error(`GitHub API Error: ${response.statusText}`);
    }
    const data = await response.json();
    const promises = data.filter(file => file.type === "file").map(file => downloadFile(file));
    const files = await Promise.all(promises);
    return files;
}
async function downloadFile(file) {
    const headers = {
        "User-Agent": "NodeJS-Script",
    };
    const response = await fetch(file.download_url, { headers });
    if (!response.ok) {
        throw new Error(`Download failed for ${file.name}: ${response.statusText}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    return { name: file.name, body: buffer };
}
