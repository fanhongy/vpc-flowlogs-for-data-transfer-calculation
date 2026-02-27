#!/usr/bin/env node
/**
 * CDK Application Entry Point
 * 
 * This file serves as the entry point for the VPC Flow Logs Data Transfer
 * calculation CDK application. It instantiates and deploys the stacks
 * for single-account and multi-account (hub/spoke) deployment patterns.
 * 
 * Note: This file requires aws-cdk-lib and constructs packages to be installed.
 * Run `npm install` before using `cdk synth` or `cdk deploy`.
 */

// When aws-cdk-lib is installed, uncomment the import below and remove the type stubs
// import * as cdk from 'aws-cdk-lib';

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

// Stack imports will be added as they are created in subsequent features
// import { SingleAccountStack } from '../lib/single-account-stack';
// import { HubStack } from '../lib/hub-stack';
// import { SpokeStack } from '../lib/spoke-stack';

const app = new cdk.App();

// Configuration from context or environment
const env: cdk.Environment = {
  account: process.env['CDK_DEFAULT_ACCOUNT'] || process.env['AWS_ACCOUNT_ID'],
  region: process.env['CDK_DEFAULT_REGION'] || process.env['AWS_REGION'] || 'us-east-1',
};

// Stack instantiation will be uncommented as stacks are implemented
// 
// Single account deployment - all resources in one account
// new SingleAccountStack(app, 'VpcFlowLogsSingleAccount', {
//   env,
//   description: 'VPC Flow Logs Data Transfer Calculator - Single Account Deployment',
// });
//
// Multi-account hub deployment - DynamoDB, Kinesis destination, Calculator Lambda
// new HubStack(app, 'VpcFlowLogsHub', {
//   env,
//   description: 'VPC Flow Logs Data Transfer Calculator - Hub Account',
// });
//
// Multi-account spoke deployment - VPC Flow Logs, CloudTrail, DDB update Lambda
// Spoke accounts send flow logs to hub account's Kinesis stream
// new SpokeStack(app, 'VpcFlowLogsSpoke', {
//   env,
//   hubAccountId: app.node.tryGetContext('hubAccountId'),
//   description: 'VPC Flow Logs Data Transfer Calculator - Spoke Account',
// });

app.synth();
