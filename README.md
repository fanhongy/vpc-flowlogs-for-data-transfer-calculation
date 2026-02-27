# VPC Flow Logs for Data Transfer Calculation

Calculate cross-Availability Zone data transfer costs using VPC Flow Logs. This solution captures VPC flow logs, maps IP addresses to availability zones, and produces metrics for cost analysis.

## Architecture Overview

This solution supports two deployment patterns:

- **Single-Account**: All resources in one AWS account -- ideal for simple setups
- **Multi-Account (Hub-Spoke)**: Central hub processes logs from multiple spoke accounts -- ideal for organizations

For detailed architecture diagrams and data flow explanations, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Prerequisites

Before deploying, ensure you have the following installed:

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | 18+ | Required for CDK CLI |
| AWS CDK CLI | 2.130+ | Install via `npm install -g aws-cdk` |
| Python | 3.11+ | For Lambda functions |
| AWS CLI | 2.x | With configured credentials |
| jq | any | For deployment scripts |

Additionally:
- AWS account(s) with appropriate permissions
- VPC(s) to monitor
- CDK bootstrapped in target account/region: `cdk bootstrap aws://ACCOUNT_ID/REGION`

## Quick Start -- Single Account

For a standalone deployment where all VPCs are in one AWS account:

### 1. Clone and Install

```bash
git clone https://github.com/aws-samples/vpc-flowlogs-for-data-transfer-calculation.git
cd vpc-flowlogs-for-data-transfer-calculation
npm install
```

### 2. Bootstrap CDK (if not already done)

```bash
cdk bootstrap aws://YOUR_ACCOUNT_ID/us-east-1
```

### 3. Deploy

```bash
./scripts/deploy-single-account.sh --vpc-ids vpc-12345678
```

Or with multiple VPCs and custom options:

```bash
./scripts/deploy-single-account.sh \
  --vpc-ids vpc-aaaa1111,vpc-bbbb2222 \
  --profile my-aws-profile \
  --region us-west-2 \
  --prefix MYAPP
```

### 4. Verify Deployment

Check the CloudFormation console or run:

```bash
aws cloudformation describe-stacks --stack-name DTAZ-SingleAccountStack
```

### 5. Configure CloudWatch Contributor Insights

After deployment, set up CloudWatch Contributor Insights for visualization:

1. Open the CloudWatch console
2. Select **Contributor Insights** from the left navigation
3. Choose **Create rule** > **Custom rule**
4. Configure:
   - **Rule name**: `CrossAZDataTransfer`
   - **Log group**: Select the calculator Lambda's log group
   - **Log format**: JSON
   - **Contribution**: `event.srcIp` and `event.destIp`
   - **Aggregate on**: SUM, `event.bytes`
5. Create the rule in enabled state

### 6. Create Alarms (Optional)

1. In the Contributor Insights rule, choose **Actions** > **View in Metrics**
2. Select **Unique Contributors**
3. Click the alarm icon to create an alarm (e.g., alert when >1GB transferred per minute)

## Multi-Account Deployment

For organizations with multiple AWS accounts, use the hub-spoke pattern:

1. **Hub Account**: Contains DynamoDB table, Kinesis stream, and Calculator Lambda
2. **Spoke Accounts**: Send VPC flow logs to the hub for centralized processing

### Quick Multi-Account Deployment

Create a configuration file from the example:

```bash
cp deploy-config.example.json deploy-config.json
# Edit deploy-config.json with your account details
```

Deploy everything with one command:

```bash
./scripts/deploy-all.sh
```

For detailed step-by-step instructions, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Configuration Reference

### deploy-config.json

```json
{
  "hubAccount": {
    "id": "111111111111",
    "region": "us-east-1",
    "profile": "hub-profile",
    "lambdaCodeBucket": "my-lambda-bucket-hub"
  },
  "spokeAccounts": [
    {
      "id": "222222222222",
      "region": "us-east-1",
      "profile": "spoke1-profile",
      "vpcIds": ["vpc-aaaa1111", "vpc-bbbb2222"],
      "lambdaCodeBucket": "my-lambda-bucket-spoke1"
    }
  ],
  "stackPrefix": "DTAZ"
}
```

### Stack Props

| Property | Stack | Description | Required |
|----------|-------|-------------|----------|
| `vpcIds` | Single, Spoke | Comma-separated VPC IDs to monitor | Yes |
| `lambdaCodeBucket` | Hub, Single, Spoke | S3 bucket for Lambda code (optional with CDK) | No |
| `spokeAccountIds` | Hub | Array of spoke account IDs | Yes (Hub) |
| `centralAccountRoleArn` | Spoke | DDB role ARN from hub stack | Yes (Spoke) |
| `destinationArn` | Spoke | CloudWatch destination ARN from hub | Yes (Spoke) |
| `existingCloudTrailBucket` | Single, Spoke | Use existing CloudTrail bucket | No |
| `stackPrefix` | All | Prefix for stack names (default: DTAZ) | No |

### Environment Variables (Lambda)

| Variable | Description |
|----------|-------------|
| `CURRENT_ACCOUNT` | Current AWS account ID |
| `DDB_NAME` | DynamoDB table name |
| `SPOKE_ACCOUNT_IDS` | Comma-separated spoke account IDs (Hub only) |

### Deployment Scripts

| Script | Description |
|--------|-------------|
| `deploy-single-account.sh` | Deploy single-account stack |
| `deploy-hub.sh` | Deploy hub stack only |
| `deploy-spoke.sh` | Deploy spoke stack only |
| `deploy-all.sh` | Orchestrate full multi-account deployment |
| `teardown.sh` | Remove all deployed stacks |
| `upload-lambda-code.sh` | Package and upload Lambda code to S3 |

## Cleanup

### Single Account

```bash
./scripts/teardown.sh --single-account
```

### Multi-Account

```bash
./scripts/teardown.sh  # Uses deploy-config.json
```

Add `--force` to skip confirmation prompts.

## Troubleshooting

For common issues and solutions, see [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## Legacy CloudFormation Templates

The original CloudFormation templates are preserved in this repository for reference:

| Template | Description |
|----------|-------------|
| `single-account-deployment.yml` | Original single-account template |
| `data-transfer-calculator.yml` | Original hub account template |
| `data-transfer-update.yml` | Original spoke account template |
| `pre-roles.yml` | Original pre-requisite IAM roles |

**Note**: These templates are no longer maintained. Use the CDK stacks for new deployments.

## Project Structure

```
.
├── bin/app.ts                    # CDK entry point
├── lib/
│   ├── constructs/               # Shared CDK constructs
│   │   ├── az-mapping-table.ts
│   │   ├── cloudtrail-construct.ts
│   │   ├── load-ddb-custom-resource.ts
│   │   ├── update-ddb-construct.ts
│   │   ├── vpc-flowlogs-construct.ts
│   │   └── index.ts
│   └── stacks/                   # CDK stacks
│       ├── hub-stack.ts
│       ├── pre-roles-stack.ts
│       ├── single-account-stack.ts
│       ├── spoke-stack.ts
│       └── index.ts
├── lambda/                       # Lambda functions (Python 3.11)
│   ├── calculator/
│   ├── create-vpc-flowlogs/
│   ├── load-az-cidr/
│   └── update-ddb-table/
├── scripts/                      # Deployment automation
│   ├── deploy-hub.sh
│   ├── deploy-spoke.sh
│   ├── deploy-all.sh
│   ├── deploy-single-account.sh
│   ├── teardown.sh
│   └── upload-lambda-code.sh
├── docs/                         # Documentation
│   ├── ARCHITECTURE.md
│   ├── DEPLOYMENT.md
│   └── TROUBLESHOOTING.md
├── deploy-config.example.json
├── package.json
├── tsconfig.json
└── cdk.json
```

## Contributors

Shiva Vaidyanathan - vaidys@amazon.com

Stan Fan - fanhongy@amazon.com

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.
