/**
 * CloudTrail Construct
 *
 * Creates CloudTrail infrastructure with CloudWatch Logs integration.
 * The trail captures API events (particularly CreateSubnet) which are
 * used to trigger DynamoDB updates for new subnet-to-AZ mappings.
 *
 * Resources created:
 * - S3 bucket for trail storage (if not provided)
 * - S3 bucket policy for CloudTrail access
 * - CloudWatch Log Group for trail events
 * - IAM role for CloudTrail to write to CloudWatch Logs
 * - CloudTrail trail
 *
 * Based on CloudFormation resources from single-account-deployment.yml:
 * - rCtrailS3Bucket
 * - rCtrailBucketPolicy
 * - rCtrailRole
 * - rCtrail
 * - rCtrailLogGroup
 */

import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudtrail from 'aws-cdk-lib/aws-cloudtrail';
import { RemovalPolicy, Stack } from 'aws-cdk-lib';

/**
 * Props for CloudTrailConstruct
 */
export interface CloudTrailProps {
  /**
   * Optional existing S3 bucket name to use for CloudTrail logs.
   * If not provided, a new bucket will be created.
   */
  readonly existingBucketName?: string;

  /**
   * Retention period for CloudTrail logs in CloudWatch.
   * @default 30 days
   */
  readonly logRetentionDays?: number;

  /**
   * Trail name.
   * @default auto-generated
   */
  readonly trailName?: string;

  /**
   * Removal policy for the S3 bucket (if created).
   * @default RemovalPolicy.RETAIN
   */
  readonly bucketRemovalPolicy?: RemovalPolicy;

  /**
   * Removal policy for the log group.
   * @default RemovalPolicy.RETAIN
   */
  readonly logGroupRemovalPolicy?: RemovalPolicy;
}

/**
 * Construct that creates a CloudTrail with CloudWatch Logs integration.
 *
 * This construct sets up CloudTrail to capture AWS API events and
 * forward them to CloudWatch Logs. This enables real-time monitoring
 * and triggering of Lambda functions on specific events like CreateSubnet.
 */
export class CloudTrailConstruct extends Construct {
  /**
   * The S3 bucket where CloudTrail logs are stored
   */
  public readonly bucket: s3.IBucket;

  /**
   * The CloudWatch Log Group where CloudTrail events are streamed
   */
  public readonly logGroup: logs.LogGroup;

  /**
   * The ARN of the CloudWatch Log Group
   */
  public readonly logGroupArn: string;

  /**
   * The CloudTrail trail
   */
  public readonly trail: cloudtrail.Trail;

  /**
   * The IAM role used by CloudTrail to write to CloudWatch Logs
   */
  public readonly cloudTrailRole: iam.Role;

  constructor(scope: Construct, id: string, props: CloudTrailProps = {}) {
    super(scope, id);

    const {
      existingBucketName,
      logRetentionDays = 30,
      trailName,
      bucketRemovalPolicy = RemovalPolicy.RETAIN,
      logGroupRemovalPolicy = RemovalPolicy.RETAIN,
    } = props;

    const stack = Stack.of(this);

    // Use existing bucket or create a new one
    if (existingBucketName) {
      this.bucket = s3.Bucket.fromBucketName(this, 'ExistingBucket', existingBucketName);
    } else {
      const newBucket = new s3.Bucket(this, 'TrailBucket', {
        removalPolicy: bucketRemovalPolicy,
        autoDeleteObjects: bucketRemovalPolicy === RemovalPolicy.DESTROY,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        encryption: s3.BucketEncryption.S3_MANAGED,
        enforceSSL: true,
      });

      // Add bucket policy for CloudTrail
      newBucket.addToResourcePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          principals: [new iam.ServicePrincipal('cloudtrail.amazonaws.com')],
          actions: ['s3:GetBucketAcl'],
          resources: [newBucket.bucketArn],
        })
      );

      newBucket.addToResourcePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          principals: [new iam.ServicePrincipal('cloudtrail.amazonaws.com')],
          actions: ['s3:PutObject'],
          resources: [`${newBucket.bucketArn}/AWSLogs/${stack.account}/*`],
          conditions: {
            StringEquals: {
              's3:x-amz-acl': 'bucket-owner-full-control',
            },
          },
        })
      );

      this.bucket = newBucket;
    }

    // Create CloudWatch Log Group for CloudTrail events
    this.logGroup = new logs.LogGroup(this, 'TrailLogGroup', {
      retention: this.mapRetentionDays(logRetentionDays),
      removalPolicy: logGroupRemovalPolicy,
    });
    this.logGroupArn = this.logGroup.logGroupArn;

    // Create IAM role for CloudTrail to write to CloudWatch Logs
    this.cloudTrailRole = new iam.Role(this, 'TrailRole', {
      assumedBy: new iam.ServicePrincipal('cloudtrail.amazonaws.com'),
      description: 'IAM role for CloudTrail to write to CloudWatch Logs',
    });

    // Grant CloudTrail permission to write to CloudWatch Logs
    this.cloudTrailRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'logs:CreateLogStream',
          'logs:PutLogEvents',
        ],
        resources: [`${this.logGroup.logGroupArn}:*`],
      })
    );

    // Create the CloudTrail trail
    this.trail = new cloudtrail.Trail(this, 'Trail', {
      trailName,
      bucket: this.bucket,
      cloudWatchLogGroup: this.logGroup,
      sendToCloudWatchLogs: true,
      cloudWatchLogsRetention: this.mapRetentionDays(logRetentionDays),
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
