/**
 * Type Declarations for CDK Libraries
 *
 * These stubs allow TypeScript to validate syntax without npm install.
 * When aws-cdk-lib is installed, this file can be removed as the real
 * type declarations from node_modules will take precedence.
 *
 * IMPORTANT: Remove this file when running in environment with npm available.
 */

// constructs package stubs
declare module 'constructs' {
  export class Construct {
    constructor(scope: Construct | undefined, id: string);
    readonly node: {
      id: string;
      path: string;
      tryGetContext(key: string): unknown;
    };
  }
}

// aws-cdk-lib core stubs
declare module 'aws-cdk-lib' {
  import { Construct } from 'constructs';

  export enum RemovalPolicy {
    DESTROY = 'destroy',
    RETAIN = 'retain',
    SNAPSHOT = 'snapshot',
  }

  export class Duration {
    static seconds(amount: number): Duration;
    static minutes(amount: number): Duration;
    static hours(amount: number): Duration;
    static days(amount: number): Duration;
  }

  export class Stack extends Construct {
    static of(construct: Construct): Stack;
    readonly account: string;
    readonly region: string;
    readonly stackName: string;
  }

  export class CustomResource extends Construct {
    constructor(scope: Construct, id: string, props: {
      serviceToken: string;
      properties?: Record<string, unknown>;
    });
    readonly ref: string;
    getAtt(attributeName: string): unknown;
    getAttString(attributeName: string): string;
  }
}

// aws-cdk-lib/aws-dynamodb stubs
declare module 'aws-cdk-lib/aws-dynamodb' {
  import { Construct } from 'constructs';
  import { RemovalPolicy } from 'aws-cdk-lib';
  import * as iam from 'aws-cdk-lib/aws-iam';

  export enum AttributeType {
    STRING = 'S',
    NUMBER = 'N',
    BINARY = 'B',
  }

  export enum BillingMode {
    PAY_PER_REQUEST = 'PAY_PER_REQUEST',
    PROVISIONED = 'PROVISIONED',
  }

  export enum ProjectionType {
    KEYS_ONLY = 'KEYS_ONLY',
    ALL = 'ALL',
    INCLUDE = 'INCLUDE',
  }

  export interface Attribute {
    name: string;
    type: AttributeType;
  }

  export interface GlobalSecondaryIndexProps {
    indexName: string;
    partitionKey: Attribute;
    sortKey?: Attribute;
    projectionType?: ProjectionType;
    nonKeyAttributes?: string[];
    readCapacity?: number;
    writeCapacity?: number;
  }

  export interface TableProps {
    tableName?: string;
    partitionKey: Attribute;
    sortKey?: Attribute;
    billingMode?: BillingMode;
    readCapacity?: number;
    writeCapacity?: number;
    removalPolicy?: RemovalPolicy;
    pointInTimeRecovery?: boolean;
    encryption?: unknown;
    stream?: unknown;
    timeToLiveAttribute?: string;
  }

  export class Table extends Construct {
    constructor(scope: Construct, id: string, props: TableProps);
    readonly tableArn: string;
    readonly tableName: string;
    readonly tableStreamArn?: string;
    addGlobalSecondaryIndex(props: GlobalSecondaryIndexProps): void;
    grantReadData(grantee: iam.IGrantable): iam.Grant;
    grantWriteData(grantee: iam.IGrantable): iam.Grant;
    grantReadWriteData(grantee: iam.IGrantable): iam.Grant;
    grantFullAccess(grantee: iam.IGrantable): iam.Grant;
  }
}

// aws-cdk-lib/aws-iam stubs
declare module 'aws-cdk-lib/aws-iam' {
  import { Construct } from 'constructs';

  export interface IGrantable {
    grantPrincipal: IPrincipal;
  }

  export interface IPrincipal {
    readonly grantPrincipal: IPrincipal;
    readonly assumeRoleAction: string;
    addToPrincipalPolicy(statement: PolicyStatement): { statementAdded: boolean; policyDependable?: unknown };
  }

  export interface Grant {
    readonly success: boolean;
    readonly principalStatement?: PolicyStatement;
    readonly resourceStatement?: PolicyStatement;
  }

  export enum Effect {
    ALLOW = 'Allow',
    DENY = 'Deny',
  }

  export interface PolicyStatementProps {
    effect?: Effect;
    actions?: string[];
    notActions?: string[];
    principals?: IPrincipal[];
    notPrincipals?: IPrincipal[];
    resources?: string[];
    notResources?: string[];
    conditions?: Record<string, Record<string, unknown>>;
  }

  export class PolicyStatement {
    constructor(props?: PolicyStatementProps);
    readonly effect: Effect;
    readonly actions: string[];
    readonly resources: string[];
    addActions(...actions: string[]): void;
    addResources(...arns: string[]): void;
    addCondition(key: string, value: unknown): void;
    addConditions(conditions: Record<string, unknown>): void;
  }

  export interface RoleProps {
    assumedBy: IPrincipal;
    roleName?: string;
    description?: string;
    path?: string;
    externalIds?: string[];
    maxSessionDuration?: unknown;
    managedPolicies?: unknown[];
    inlinePolicies?: Record<string, unknown>;
  }

  export class Role extends Construct implements IGrantable, IPrincipal {
    constructor(scope: Construct, id: string, props: RoleProps);
    readonly roleArn: string;
    readonly roleName: string;
    readonly grantPrincipal: IPrincipal;
    readonly assumeRoleAction: string;
    addToPolicy(statement: PolicyStatement): boolean;
    addToPrincipalPolicy(statement: PolicyStatement): { statementAdded: boolean; policyDependable?: unknown };
    attachInlinePolicy(policy: unknown): void;
    addManagedPolicy(policy: unknown): void;
    grant(grantee: IPrincipal, ...actions: string[]): Grant;
    grantPassRole(grantee: IPrincipal): Grant;
    grantAssumeRole(grantee: IPrincipal): Grant;
  }

  export class ServicePrincipal implements IPrincipal {
    constructor(service: string, opts?: { region?: string; conditions?: Record<string, unknown> });
    readonly grantPrincipal: IPrincipal;
    readonly assumeRoleAction: string;
    addToPrincipalPolicy(statement: PolicyStatement): { statementAdded: boolean; policyDependable?: unknown };
  }

  export class ArnPrincipal implements IPrincipal {
    constructor(arn: string);
    readonly arn: string;
    readonly grantPrincipal: IPrincipal;
    readonly assumeRoleAction: string;
    addToPrincipalPolicy(statement: PolicyStatement): { statementAdded: boolean; policyDependable?: unknown };
  }

  export class AccountPrincipal implements IPrincipal {
    constructor(accountId: string);
    readonly accountId: string;
    readonly grantPrincipal: IPrincipal;
    readonly assumeRoleAction: string;
    addToPrincipalPolicy(statement: PolicyStatement): { statementAdded: boolean; policyDependable?: unknown };
  }
}

// aws-cdk-lib/aws-lambda stubs
declare module 'aws-cdk-lib/aws-lambda' {
  import { Construct } from 'constructs';
  import { Duration } from 'aws-cdk-lib';
  import * as iam from 'aws-cdk-lib/aws-iam';
  import * as logs from 'aws-cdk-lib/aws-logs';

  export class Runtime {
    static readonly PYTHON_3_7: Runtime;
    static readonly PYTHON_3_8: Runtime;
    static readonly PYTHON_3_9: Runtime;
    static readonly PYTHON_3_10: Runtime;
    static readonly PYTHON_3_11: Runtime;
    static readonly PYTHON_3_12: Runtime;
    static readonly NODEJS_14_X: Runtime;
    static readonly NODEJS_16_X: Runtime;
    static readonly NODEJS_18_X: Runtime;
    static readonly NODEJS_20_X: Runtime;
    readonly name: string;
    readonly family?: string;
  }

  export class Code {
    static fromAsset(path: string, options?: unknown): Code;
    static fromBucket(bucket: unknown, key: string, objectVersion?: string): Code;
    static fromInline(code: string): Code;
  }

  export interface FunctionProps {
    runtime: Runtime;
    handler: string;
    code: Code;
    functionName?: string;
    description?: string;
    timeout?: Duration;
    memorySize?: number;
    role?: iam.Role;
    environment?: Record<string, string>;
    vpc?: unknown;
    vpcSubnets?: unknown;
    securityGroups?: unknown[];
    reservedConcurrentExecutions?: number;
    tracing?: unknown;
    logRetention?: logs.RetentionDays;
    layers?: unknown[];
  }

  export class Function extends Construct implements iam.IGrantable {
    constructor(scope: Construct, id: string, props: FunctionProps);
    readonly functionArn: string;
    readonly functionName: string;
    readonly grantPrincipal: iam.IPrincipal;
    readonly role?: iam.Role;
    addEnvironment(key: string, value: string, options?: unknown): this;
    addPermission(id: string, permission: unknown): void;
    grantInvoke(grantee: iam.IGrantable): iam.Grant;
    addToRolePolicy(statement: iam.PolicyStatement): void;
  }
}

// aws-cdk-lib/aws-logs stubs
declare module 'aws-cdk-lib/aws-logs' {
  import { Construct } from 'constructs';
  import { RemovalPolicy } from 'aws-cdk-lib';
  import * as iam from 'aws-cdk-lib/aws-iam';

  export enum RetentionDays {
    ONE_DAY = 1,
    THREE_DAYS = 3,
    FIVE_DAYS = 5,
    ONE_WEEK = 7,
    TWO_WEEKS = 14,
    ONE_MONTH = 30,
    TWO_MONTHS = 60,
    THREE_MONTHS = 90,
    FOUR_MONTHS = 120,
    FIVE_MONTHS = 150,
    SIX_MONTHS = 180,
    ONE_YEAR = 365,
    THIRTEEN_MONTHS = 400,
    EIGHTEEN_MONTHS = 545,
    TWO_YEARS = 731,
    THREE_YEARS = 1096,
    FIVE_YEARS = 1827,
    SIX_YEARS = 2192,
    SEVEN_YEARS = 2557,
    EIGHT_YEARS = 2922,
    NINE_YEARS = 3288,
    TEN_YEARS = 3653,
    INFINITE = 9999,
  }

  export interface LogGroupProps {
    logGroupName?: string;
    retention?: RetentionDays;
    removalPolicy?: RemovalPolicy;
    encryptionKey?: unknown;
  }

  export class LogGroup extends Construct {
    constructor(scope: Construct, id: string, props?: LogGroupProps);
    readonly logGroupArn: string;
    readonly logGroupName: string;
    grantRead(grantee: iam.IGrantable): iam.Grant;
    grantWrite(grantee: iam.IGrantable): iam.Grant;
    addSubscriptionFilter(id: string, props: unknown): unknown;
  }

  export interface SubscriptionFilterProps {
    logGroup: LogGroup;
    destination: unknown;
    filterPattern: FilterPattern;
  }

  export class SubscriptionFilter extends Construct {
    constructor(scope: Construct, id: string, props: SubscriptionFilterProps);
  }

  export class FilterPattern {
    static allEvents(): FilterPattern;
    static allTerms(...terms: string[]): FilterPattern;
    static anyTerm(...terms: string[]): FilterPattern;
    static literal(pattern: string): FilterPattern;
  }
}

// aws-cdk-lib/aws-s3 stubs
declare module 'aws-cdk-lib/aws-s3' {
  import { Construct } from 'constructs';
  import { RemovalPolicy } from 'aws-cdk-lib';
  import * as iam from 'aws-cdk-lib/aws-iam';

  export enum BucketEncryption {
    UNENCRYPTED = 'UNENCRYPTED',
    S3_MANAGED = 'S3_MANAGED',
    KMS_MANAGED = 'KMS_MANAGED',
    KMS = 'KMS',
  }

  export class BlockPublicAccess {
    static readonly BLOCK_ALL: BlockPublicAccess;
    static readonly BLOCK_ACLS: BlockPublicAccess;
  }

  export interface IBucket {
    readonly bucketArn: string;
    readonly bucketName: string;
    readonly bucketWebsiteUrl: string;
    readonly bucketRegionalDomainName: string;
    grantRead(identity: iam.IGrantable, objectsKeyPattern?: string): iam.Grant;
    grantWrite(identity: iam.IGrantable, objectsKeyPattern?: string): iam.Grant;
    grantReadWrite(identity: iam.IGrantable, objectsKeyPattern?: string): iam.Grant;
    grantPut(identity: iam.IGrantable, objectsKeyPattern?: string): iam.Grant;
    grantDelete(identity: iam.IGrantable, objectsKeyPattern?: string): iam.Grant;
    addToResourcePolicy(permission: iam.PolicyStatement): { statementAdded: boolean };
  }

  export interface BucketProps {
    bucketName?: string;
    versioned?: boolean;
    encryption?: BucketEncryption;
    encryptionKey?: unknown;
    blockPublicAccess?: BlockPublicAccess;
    publicReadAccess?: boolean;
    removalPolicy?: RemovalPolicy;
    autoDeleteObjects?: boolean;
    enforceSSL?: boolean;
    lifecycleRules?: unknown[];
    cors?: unknown[];
  }

  export class Bucket extends Construct implements IBucket {
    constructor(scope: Construct, id: string, props?: BucketProps);
    readonly bucketArn: string;
    readonly bucketName: string;
    readonly bucketWebsiteUrl: string;
    readonly bucketRegionalDomainName: string;
    static fromBucketName(scope: Construct, id: string, bucketName: string): IBucket;
    static fromBucketArn(scope: Construct, id: string, bucketArn: string): IBucket;
    grantRead(identity: iam.IGrantable, objectsKeyPattern?: string): iam.Grant;
    grantWrite(identity: iam.IGrantable, objectsKeyPattern?: string): iam.Grant;
    grantReadWrite(identity: iam.IGrantable, objectsKeyPattern?: string): iam.Grant;
    grantPut(identity: iam.IGrantable, objectsKeyPattern?: string): iam.Grant;
    grantDelete(identity: iam.IGrantable, objectsKeyPattern?: string): iam.Grant;
    addToResourcePolicy(permission: iam.PolicyStatement): { statementAdded: boolean };
  }
}

// aws-cdk-lib/aws-cloudtrail stubs
declare module 'aws-cdk-lib/aws-cloudtrail' {
  import { Construct } from 'constructs';
  import * as s3 from 'aws-cdk-lib/aws-s3';
  import * as logs from 'aws-cdk-lib/aws-logs';

  export interface TrailProps {
    trailName?: string;
    bucket?: s3.IBucket;
    s3KeyPrefix?: string;
    cloudWatchLogGroup?: logs.LogGroup;
    cloudWatchLogsRetention?: logs.RetentionDays;
    sendToCloudWatchLogs?: boolean;
    enableFileValidation?: boolean;
    isMultiRegionTrail?: boolean;
    includeGlobalServiceEvents?: boolean;
    managementEvents?: unknown;
  }

  export class Trail extends Construct {
    constructor(scope: Construct, id: string, props?: TrailProps);
    readonly trailArn: string;
    readonly trailSnsTopicArn?: string;
    logAllLambdaDataEvents(options?: unknown): void;
    logAllS3DataEvents(options?: unknown): void;
    addEventSelector(dataResourceType: unknown, dataResourceValues: string[], options?: unknown): void;
  }
}

// aws-cdk-lib/custom-resources stubs
declare module 'aws-cdk-lib/custom-resources' {
  import { Construct } from 'constructs';
  import * as lambda from 'aws-cdk-lib/aws-lambda';
  import * as logs from 'aws-cdk-lib/aws-logs';

  export interface ProviderProps {
    onEventHandler: lambda.Function;
    isCompleteHandler?: lambda.Function;
    queryInterval?: unknown;
    totalTimeout?: unknown;
    logRetention?: logs.RetentionDays;
    role?: unknown;
    vpc?: unknown;
    vpcSubnets?: unknown;
    securityGroups?: unknown[];
  }

  export class Provider extends Construct {
    constructor(scope: Construct, id: string, props: ProviderProps);
    readonly serviceToken: string;
    readonly onEventHandler: lambda.Function;
    readonly isCompleteHandler?: lambda.Function;
  }
}
