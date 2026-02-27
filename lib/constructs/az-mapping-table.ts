/**
 * AZ Mapping Table Construct
 *
 * Creates a DynamoDB table for storing subnet-to-AZ mapping information.
 * This table is used by the Calculator Lambda to determine cross-AZ data transfers.
 *
 * Schema:
 * - SubnetId (HASH key) - The subnet identifier
 * - CidrBlock (RANGE key) - The CIDR block of the subnet
 * - GSI on AvailabilityZoneId for efficient lookups by AZ
 *
 * Based on CloudFormation resource rDynamoDBTable from single-account-deployment.yml
 */

import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { RemovalPolicy } from 'aws-cdk-lib';

/**
 * Props for AzMappingTableConstruct
 */
export interface AzMappingTableProps {
  /**
   * Optional table name. If not provided, a name will be auto-generated.
   * @default 'AZsMapping'
   */
  readonly tableName?: string;

  /**
   * Read capacity units for the table and GSI.
   * @default 5
   */
  readonly readCapacity?: number;

  /**
   * Write capacity units for the table and GSI.
   * @default 5
   */
  readonly writeCapacity?: number;

  /**
   * Optional cross-account principal ARN that needs access to this table.
   * When provided, creates an IAM role that can be assumed for cross-account access.
   */
  readonly crossAccountPrincipal?: string;

  /**
   * Removal policy for the table.
   * @default RemovalPolicy.RETAIN
   */
  readonly removalPolicy?: RemovalPolicy;
}

/**
 * Construct that creates a DynamoDB table for AZ-to-subnet mapping.
 *
 * The table stores subnet information including:
 * - SubnetId: The unique identifier for the subnet
 * - CidrBlock: The CIDR block assigned to the subnet
 * - AvailabilityZoneId: The AZ ID where the subnet resides
 *
 * A Global Secondary Index on AvailabilityZoneId enables efficient
 * queries to find all subnets in a particular availability zone.
 */
export class AzMappingTableConstruct extends Construct {
  /**
   * The DynamoDB table for AZ mappings
   */
  public readonly table: dynamodb.Table;

  /**
   * The ARN of the DynamoDB table
   */
  public readonly tableArn: string;

  /**
   * The name of the DynamoDB table
   */
  public readonly tableName: string;

  /**
   * The IAM role for cross-account access (if crossAccountPrincipal was provided)
   */
  public readonly crossAccountRole?: iam.Role;

  constructor(scope: Construct, id: string, props: AzMappingTableProps = {}) {
    super(scope, id);

    const {
      tableName = 'AZsMapping',
      readCapacity = 5,
      writeCapacity = 5,
      crossAccountPrincipal,
      removalPolicy = RemovalPolicy.RETAIN,
    } = props;

    // Create the DynamoDB table with SubnetId as HASH and CidrBlock as RANGE
    this.table = new dynamodb.Table(this, 'Table', {
      tableName,
      partitionKey: {
        name: 'SubnetId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'CidrBlock',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PROVISIONED,
      readCapacity,
      writeCapacity,
      removalPolicy,
    });

    // Add GSI on AvailabilityZoneId for efficient AZ lookups
    this.table.addGlobalSecondaryIndex({
      indexName: 'AvailabilityZoneId',
      partitionKey: {
        name: 'AvailabilityZoneId',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
      readCapacity,
      writeCapacity,
    });

    this.tableArn = this.table.tableArn;
    this.tableName = this.table.tableName;

    // Create cross-account IAM role if a principal is provided
    if (crossAccountPrincipal) {
      this.crossAccountRole = new iam.Role(this, 'CrossAccountRole', {
        assumedBy: new iam.ArnPrincipal(crossAccountPrincipal),
        description: 'Role for cross-account access to AZ mapping DynamoDB table',
      });

      // Grant read/write permissions to the table
      this.table.grantReadWriteData(this.crossAccountRole);
    }
  }
}
