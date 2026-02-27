/**
 * VPC Flow Logs Construct
 *
 * Creates VPC Flow Logs infrastructure using a custom resource Lambda.
 * Flow logs are sent to CloudWatch Logs for processing by the Calculator Lambda.
 *
 * Resources created:
 * - CloudWatch Log Group for flow logs
 * - IAM role for VPC Flow Logs to publish to CloudWatch
 * - Lambda function for custom resource handling
 * - IAM role for Lambda execution
 * - Custom resource to create flow logs for specified VPCs
 *
 * Based on CloudFormation resources from single-account-deployment.yml:
 * - rVpcFlowLogGroup
 * - rVpcFlogLogPublishRole
 * - rCreatVPCFlowlogsLambda
 * - rCreatVPCFlowlogsLambdaExecRole
 * - rVpcFlowLogs (custom resource)
 */

import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Duration, RemovalPolicy, CustomResource } from 'aws-cdk-lib';

/**
 * Props for VpcFlowLogsConstruct
 */
export interface VpcFlowLogsProps {
  /**
   * List of VPC IDs to create flow logs for.
   */
  readonly vpcIds: string[];

  /**
   * Retention period for flow logs in CloudWatch.
   * @default 30 days
   */
  readonly logRetentionDays?: number;

  /**
   * Removal policy for the log group.
   * @default RemovalPolicy.RETAIN
   */
  readonly removalPolicy?: RemovalPolicy;
}

/**
 * Construct that creates VPC Flow Logs for specified VPCs.
 *
 * This construct uses a custom resource pattern to create flow logs
 * because CDK's native VPC Flow Logs require a VPC construct instance,
 * but we often only have VPC IDs from context or parameters.
 *
 * The custom resource Lambda handles Create, Update, and Delete operations
 * for VPC flow logs, ensuring proper lifecycle management.
 */
export class VpcFlowLogsConstruct extends Construct {
  /**
   * The CloudWatch Log Group where flow logs are delivered
   */
  public readonly logGroup: logs.LogGroup;

  /**
   * The ARN of the CloudWatch Log Group
   */
  public readonly logGroupArn: string;

  /**
   * The IAM role used by VPC Flow Logs to publish to CloudWatch
   */
  public readonly flowLogPublishRole: iam.Role;

  /**
   * The Lambda function used by the custom resource
   */
  public readonly customResourceLambda: lambda.Function;

  constructor(scope: Construct, id: string, props: VpcFlowLogsProps) {
    super(scope, id);

    const {
      vpcIds,
      logRetentionDays = 30,
      removalPolicy = RemovalPolicy.RETAIN,
    } = props;

    // Create CloudWatch Log Group for flow logs
    this.logGroup = new logs.LogGroup(this, 'FlowLogGroup', {
      retention: this.mapRetentionDays(logRetentionDays),
      removalPolicy,
    });
    this.logGroupArn = this.logGroup.logGroupArn;

    // Create IAM role for VPC Flow Logs to publish to CloudWatch
    this.flowLogPublishRole = new iam.Role(this, 'FlowLogPublishRole', {
      assumedBy: new iam.ServicePrincipal('vpc-flow-logs.amazonaws.com'),
      description: 'IAM role for VPC Flow Logs to publish to CloudWatch Logs',
    });

    // Grant permissions to publish logs
    this.flowLogPublishRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
          'logs:DescribeLogGroups',
          'logs:DescribeLogStreams',
        ],
        resources: ['*'],
      })
    );

    // Create IAM role for the custom resource Lambda
    const lambdaExecRole = new iam.Role(this, 'LambdaExecRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Execution role for VPC Flow Logs custom resource Lambda',
    });

    // Add CloudWatch Logs permissions
    lambdaExecRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
        ],
        resources: ['arn:aws:logs:*:*:*'],
      })
    );

    // Add EC2 permissions for flow log management
    lambdaExecRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'ec2:CreateFlowLogs',
          'ec2:DeleteFlowLogs',
          'ec2:DescribeFlowLogs',
        ],
        resources: ['*'],
      })
    );

    // Add IAM PassRole permission for the flow log publish role
    lambdaExecRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['iam:PassRole'],
        resources: [this.flowLogPublishRole.roleArn],
      })
    );

    // Create the custom resource Lambda function
    this.customResourceLambda = new lambda.Function(this, 'CreateFlowLogsLambda', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromAsset('lambda/create-vpc-flowlogs'),
      role: lambdaExecRole,
      timeout: Duration.seconds(150),
      description: 'Custom resource Lambda to create VPC Flow Logs',
    });

    // Create the custom resource provider
    const provider = new cr.Provider(this, 'FlowLogsProvider', {
      onEventHandler: this.customResourceLambda,
    });

    // Create the custom resource to trigger flow log creation
    new CustomResource(this, 'FlowLogsCustomResource', {
      serviceToken: provider.serviceToken,
      properties: {
        VpcIds: vpcIds,
        LogGroupArn: this.logGroup.logGroupArn,
        VpcFlogLogPublishRole: this.flowLogPublishRole.roleArn,
      },
    });
  }

  /**
   * Maps retention days to CDK RetentionDays enum.
   * Falls back to closest supported value if exact match not found.
   */
  private mapRetentionDays(days: number): logs.RetentionDays {
    const retentionMap: Record<number, logs.RetentionDays> = {
      1: logs.RetentionDays.ONE_DAY,
      3: logs.RetentionDays.THREE_DAYS,
      5: logs.RetentionDays.FIVE_DAYS,
      7: logs.RetentionDays.ONE_WEEK,
      14: logs.RetentionDays.TWO_WEEKS,
      30: logs.RetentionDays.ONE_MONTH,
      60: logs.RetentionDays.TWO_MONTHS,
      90: logs.RetentionDays.THREE_MONTHS,
      120: logs.RetentionDays.FOUR_MONTHS,
      150: logs.RetentionDays.FIVE_MONTHS,
      180: logs.RetentionDays.SIX_MONTHS,
      365: logs.RetentionDays.ONE_YEAR,
      400: logs.RetentionDays.THIRTEEN_MONTHS,
      545: logs.RetentionDays.EIGHTEEN_MONTHS,
      731: logs.RetentionDays.TWO_YEARS,
      1096: logs.RetentionDays.THREE_YEARS,
      1827: logs.RetentionDays.FIVE_YEARS,
      2192: logs.RetentionDays.SIX_YEARS,
      2557: logs.RetentionDays.SEVEN_YEARS,
      2922: logs.RetentionDays.EIGHT_YEARS,
      3288: logs.RetentionDays.NINE_YEARS,
      3653: logs.RetentionDays.TEN_YEARS,
    };

    return retentionMap[days] ?? logs.RetentionDays.ONE_MONTH;
  }
}
