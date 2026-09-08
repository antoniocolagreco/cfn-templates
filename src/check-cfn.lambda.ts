import { DeleteObjectsCommand, ListObjectsV2Command, ListObjectsV2CommandOutput, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type {
    CloudFormationCustomResourceEvent,
    CloudFormationCustomResourceResponse,
    Context,
} from "aws-lambda";

type Status = CloudFormationCustomResourceResponse["Status"]
type Event = CloudFormationCustomResourceEvent<{ BucketName: string }>

type GitItem = {
    name: string,
    path: string,
    sha: string,
    size: number,
    url: string,
    html_url: string,
    git_url: string,
    download_url: string,
    type: string
    _links: {
        self: string,
        git: string,
        html: string
    }
};

type GitHubRepoParams = {
    owner: string, repo: string, branch?: string, path?: string, token?: string
}

const s3 = new S3Client()

export const handler = async (event: Event, context: Context) => {
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
    } catch (err) {
        console.error(err);
        await sendResponse(event, context, "FAILED", {});
    }
};

async function sendResponse(event: Event, context: Context, status: Status, data: Record<string, unknown>) {
    const respondeObject: CloudFormationCustomResourceResponse = {
        Status: status,
        Reason: `See CloudWatch log stream: ${context.logStreamName}`,
        PhysicalResourceId: context.logStreamName,
        StackId: event.StackId,
        RequestId: event.RequestId,
        LogicalResourceId: event.LogicalResourceId,
        Data: data,
    }

    const body = JSON.stringify(respondeObject);

    await fetch(event.ResponseURL, {
        method: "PUT",
        body,
    });
}


async function populateBucket(bucketName: string) {
    const files = await getGitHubRepoFiles({ owner: "antoniocolagreco", repo: "test-files" })
    for (const file of files) {
        await s3.send(new PutObjectCommand({ Bucket: bucketName, Key: file.name, Body: file.body }))
    }

}

async function emptyBucket(bucketName: string) {
    let token: string | undefined = undefined;

    do {
        const list: ListObjectsV2CommandOutput = await s3.send(new ListObjectsV2Command({
            Bucket: bucketName,
            ContinuationToken: token,
        }));

        if (list.Contents?.length) {
            await s3.send(new DeleteObjectsCommand({
                Bucket: bucketName,
                Delete: { Objects: list.Contents.map(o => ({ Key: o.Key! })) },
            }));
        }

        token = list.NextContinuationToken;
    } while (token);
}

function getGitHubUrl({ owner, repo, path = "", branch }: GitHubRepoParams) {
    const url = new URL(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`);
    if (branch) url.searchParams.set("ref", branch);
    return url.toString();
}

async function getGitHubRepoFiles(params: GitHubRepoParams) {
    const url = getGitHubUrl(params)
    const headers: HeadersInit = {
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
    const data: Array<GitItem> = await response.json();

    const promises = data.filter(file => file.type === "file").map(file => downloadFile(file))

    const files = await Promise.all(promises)

    return files
}

async function downloadFile(file: GitItem) {
    const headers: HeadersInit = {
        "User-Agent": "NodeJS-Script",
    };
    const response = await fetch(file.download_url, { headers });
    if (!response.ok) {
        throw new Error(`Download failed for ${file.name}: ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return { name: file.name, body: buffer };
}

