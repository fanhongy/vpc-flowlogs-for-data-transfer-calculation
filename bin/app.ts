#!/usr/bin/env node
/**
 * CDK Application Entry Point
 *
 * This file serves as the entry point for the VPC Flow Logs Data Transfer
 * calculation CDK application. It instantiates and deploys the stacks
 * for single-account and multi-account (hub/spoke) deployment patterns.
 *
 * Deployment Scenarios:
 * 1. Single Account - All resources in one account (SingleAccountStack)
 * 2. Multi-Account Hub - Central account with DynamoDB, Kinesis, Calculator (HubStack)
 * 3. Multi-Account Spoke - Satellite accounts sending logs to hub (SpokeStack)
 * 4. Pre-Roles - IAM role setup in spoke accounts before SpokeStack (PreRolesStack)
 *
 * Note: This file requires aws-cdk-lib and constructs packages to be installed.
 * Run `npm install` before using `cdk synth` or `cdk deploy`.
 */

// When aws-cdk-lib is installed, uncomment the import below and remove the type stubs
// import * as cdk from 'aws-cdk-lib';

// Import stacks - uncomment when deploying
// import {
//   SingleAccountStack,
//   HubStack,
//   SpokeStack,
//   PreRolesStack,
// } from '../lib/stacks';

// Type stubs for syntax validation without npm install
// These will be replaced by actual aws-cdk-lib types when dependencies are installed
namespace cdk {
  export interface Environment {
    account?: string;
    region?: string;
  }

  export interface StackProps {
    env?: Environment;
    description?: string;
  }

  export class App {
    node = {
      tryGetContext: (key: string): string | undefined => undefined
    };
    synth(): void {}
  }
}

// Declare process for Node.js environment
declare const process: {
  env: Record<string, string | undefined>;
};

const app = new cdk.App();

// Configuration from context or environment
const env: cdk.Environment = {
  account: process.env['CDK_DEFAULT_ACCOUNT'] || process.env['AWS_ACCOUNT_ID'],
  region: process.env['CDK_DEFAULT_REGION'] || process.env['AWS_REGION'] || 'us-east-1',
};

// ============================================================================
// DEPLOYMENT OPTION 1: Single Account
// ============================================================================
// Use this for standalone deployments where all VPCs are in a single AWS account.
// All resources (DynamoDB, Calculator Lambda, CloudTrail) are created locally.
//
// new SingleAccountStack(app, 'DTAZ-SingleAccount', {
//   env,
//   description: 'VPC Flow Logs Data Transfer Calculator - Single Account',
//   vpcIds: ['vpc-12345678', 'vpc-87654321'],  // VPCs to monitor
//   // Optional: existingCloudTrailBucket: 'my-cloudtrail-bucket',
// });

// ============================================================================
// DEPLOYMENT OPTION 2: Multi-Account (Hub + Spoke)
// ============================================================================
// Use this for organizations with multiple AWS accounts. The hub account
// aggregates flow logs from all spoke accounts and processes them centrally.
//
// Step 1: Deploy PreRolesStack to each spoke account
// This creates the IAM role that allows hub account access
//
// const hubAccountId = '111111111111';  // Replace with actual hub account ID
// new PreRolesStack(app, 'DTAZ-PreRoles', {
//   env,
//   description: 'VPC Flow Logs Data Transfer Calculator - Pre-Roles',
//   centralAccountId: hubAccountId,
// });
//
// Step 2: Deploy HubStack to the hub account
// This creates the central DynamoDB, Kinesis stream, and Calculator Lambda
//
// const spokeAccountIds = ['222222222222', '333333333333'];  // Replace with spoke account IDs
// const hubStack = new HubStack(app, 'DTAZ-Hub', {
//   env,
//   description: 'VPC Flow Logs Data Transfer Calculator - Hub Account',
//   lambdaCodeBucket: 'my-lambda-code-bucket',
//   spokeAccountIds,
// });
//
// Step 3: Deploy SpokeStack to each spoke account
// Pass the hub stack outputs as props for cross-account integration
// Note: In practice, you would get these values from CloudFormation exports
// or SSM parameters after deploying the hub stack
//
// new SpokeStack(app, 'DTAZ-Spoke', {
//   env: { account: '222222222222', region: 'us-east-1' },
//   description: 'VPC Flow Logs Data Transfer Calculator - Spoke Account',
//   vpcIds: ['vpc-spoke-12345'],  // VPCs in this spoke account
//   centralAccountRoleArn: hubStack.ddbRoleArn,  // Or use Fn.importValue
//   destinationArn: hubStack.destinationArn,      // Or use Fn.importValue
//   // Optional: existingCloudTrailBucket: 'spoke-cloudtrail-bucket',
// });

// ============================================================================
// DEPLOYMENT OPTION 3: Hybrid (Single Account acting as Hub)
// ============================================================================
// Use this when you have a primary account with VPCs and also want to
// receive flow logs from additional spoke accounts.
//
// new SingleAccountStack(app, 'DTAZ-Hybrid', {
//   env,
//   description: 'VPC Flow Logs Data Transfer Calculator - Hybrid',
//   vpcIds: ['vpc-primary-12345'],
//   spokeAccountIds: ['222222222222', '333333333333'],  // Additional spoke accounts
// });

app.synth();
