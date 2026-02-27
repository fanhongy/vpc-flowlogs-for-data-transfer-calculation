/**
 * Spoke Stack
 *
 * Creates spoke account infrastructure for multi-account VPC Flow Logs
 * data transfer calculation. This stack sends flow logs to the hub account
 * and updates the central DynamoDB table for new subnet-to-AZ mappings.
 *
 * Based on CloudFormation template: data-transfer-update.yml
 *
 * Architecture:
 * - VPC Flow Logs for specified VPCs -> CloudWatch Logs
 * - CloudWatch Logs subscription filter sends logs to hub's CloudWatch Logs destination
 * - CloudTrail captures CreateSubnet events
 * - UpdateDDB Lambda updates central DynamoDB via cross-account role
 * - LoadDDB custom resource populates initial data to central DynamoDB
 *
 * Key difference from SingleAccountStack:
 * - Does NOT create its own DynamoDB table or Calculator Lambda
 * - Sends flow logs to hub account's CloudWatch Logs destination (which routes to Kinesis)
 * - Uses centralAccountRoleArn for cross-account DynamoDB access
 */

import { Stack, StackProps, Aws, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as logs from 'aws-cdk-lib/aws-logs';

import {
  VpcFlowLogsConstruct,
  CloudTrailConstruct,
  LoadDdbCustomResourceConstruct,
  UpdateDdbConstruct,
} from '../constructs';

/**
 * Props for SpokeStack
 */
export interface SpokeStackProps extends StackProps {
  /**
   * List of VPC IDs to monitor for flow logs in this spoke account.
   * Flow logs will be created for each VPC.
   */
  readonly vpcIds: string[];

  /**
   * S3 bucket containing Lambda code.
   * Note: In CDK, we use Code.fromAsset, but this prop maintains
   * compatibility with existing deployment scripts.
   * @optional
   */
  readonly lambdaCodeBucket?: string;

  /**
   * IAM role ARN from hub stack that grants access to the central DynamoDB table.
   * This is the DDBRoleArn output from HubStack.
   * Required for spoke accounts to update the AZ mapping table.
   */
  readonly centralAccountRoleArn: string;

  /**
   * CloudWatch Logs destination ARN from hub stack.
   * This is the CWDestinationArn output from HubStack.
   * Flow logs are sent to this destination which routes to the hub's Kinesis stream.
   */
  readonly destinationArn: string;

  /**
   * Optional existing CloudTrail S3 bucket name.
   * If not provided, a new bucket will be created.
   */
  readonly existingCloudTrailBucket?: string;
}

/**
 * Stack that creates spoke account infrastructure for multi-account deployment.
 *
 * This stack is deployed in spoke accounts and integrates with the hub account's
 * central infrastructure. Flow logs are sent to the hub for processing, and
 * AZ mapping updates are written to the hub's DynamoDB table.
 *
 * Resources created:
 * - VPC Flow Logs infrastructure (log group, IAM roles, custom resource Lambda)
 * - CloudWatch Logs subscription filter to hub's destination
 * - CloudTrail with UpdateDDB Lambda for maintaining AZ mappings
 * - LoadDDB custom resource for initial data population
 *
 * Note: Unlike SingleAccountStack, this stack does NOT create:
 * - DynamoDB table (uses hub's table via cross-account role)
 * - Calculator Lambda (hub processes all flow logs centrally)
 */
export class SpokeStack extends Stack {
  /**
   * The VPC Flow Logs construct
   */
  public readonly vpcFlowLogs: VpcFlowLogsConstruct;

  /**
   * The CloudTrail construct
   */
  public readonly cloudTrail: CloudTrailConstruct;

  /**
   * The CloudWatch Logs subscription filter to hub's destination (L1 construct)
   */
  public readonly flowLogSubscriptionFilter: logs.CfnSubscriptionFilter;

  constructor(scope: Construct, id: string, props: SpokeStackProps) {
    super(scope, id, props);

    const {
      vpcIds,
      centralAccountRoleArn,
      destinationArn,
      existingCloudTrailBucket,
    } = props;

    // Create VPC Flow Logs for specified VPCs
    this.vpcFlowLogs = new VpcFlowLogsConstruct(this, 'VpcFlowLogs', {
      vpcIds,
      logRetentionDays: 30,
    });

    // Create CloudWatch Logs subscription filter to send flow logs to hub's destination
    // The hub's destination routes logs to a Kinesis stream for processing
    // Filter pattern matches valid VPC flow log entries with actual IP addresses
    // Using CfnSubscriptionFilter (L1) for cross-account destination support
    const flowLogFilterPattern = '[version, account_id, interface_id, srcaddr != "-", dstaddr != "-", srcport != "-", dstport != "-", protocol, packets, bytes, start, end, action, log_status]';

    this.flowLogSubscriptionFilter = new logs.CfnSubscriptionFilter(this, 'FlowLogToHubSubscription', {
      logGroupName: this.vpcFlowLogs.logGroup.logGroupName,
      destinationArn,
      filterPattern: flowLogFilterPattern,
      // No roleArn needed - the hub's destination policy grants access to spoke accounts
    });

    // Create CloudTrail infrastructure
    this.cloudTrail = new CloudTrailConstruct(this, 'CloudTrail', {
      existingBucketName: existingCloudTrailBucket,
      logRetentionDays: 30,
    });

    // Create UpdateDDB construct to maintain AZ mappings on CreateSubnet events
    // Uses centralAccountRoleArn for cross-account DynamoDB access
    new UpdateDdbConstruct(this, 'UpdateDdb', {
      cloudTrailLogGroup: this.cloudTrail.logGroup,
      centralAccountRoleArn,
    });

    // Create LoadDDB custom resource for initial data population
    // Uses centralAccountRoleArn for cross-account DynamoDB access
    new LoadDdbCustomResourceConstruct(this, 'LoadDdb', {
      centralAccountRoleArn,
    });

    // Stack outputs
    new CfnOutput(this, 'FlowLogGroupArn', {
      value: this.vpcFlowLogs.logGroupArn,
      description: 'ARN of the VPC Flow Logs CloudWatch Log Group',
      exportName: `${this.stackName}-FlowLogGroupArn`,
    });

    new CfnOutput(this, 'SpokeAccountId', {
      value: Aws.ACCOUNT_ID,
      description: 'The AWS Account ID of this spoke account',
      exportName: `${this.stackName}-AccountId`,
    });
  }
}
