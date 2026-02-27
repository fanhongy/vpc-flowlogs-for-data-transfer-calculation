# Architecture

This document describes the architecture of the VPC Flow Logs Data Transfer Calculation solution.

## Overview

The solution captures VPC Flow Logs, maps IP addresses to Availability Zones using subnet CIDR blocks, and calculates cross-AZ data transfer for cost analysis. It supports both single-account and multi-account (hub-spoke) deployment patterns.

## Single-Account Architecture

In a single-account deployment, all resources are created within one AWS account.

```
                            Single AWS Account
+------------------------------------------------------------------------+
|                                                                        |
|  +-------------+     +------------------+     +-------------------+    |
|  |   VPC(s)    |---->| CloudWatch Logs  |---->|  Calculator       |    |
|  | Flow Logs   |     | (Flow Log Group) |     |  Lambda           |    |
|  +-------------+     +------------------+     +-------------------+    |
|                            |                         |                 |
|                            | Subscription            | Query/Emit      |
|                            | Filter                  |                 |
|                            |                         v                 |
|                            |                 +-------------------+     |
|                            |                 |    DynamoDB       |     |
|                            |                 |  (AZsMapping)     |     |
|                            |                 +-------------------+     |
|                            |                         ^                 |
|                            |                         |                 |
|  +-------------+     +------------------+     +-------------------+    |
|  | CloudTrail  |---->| CloudWatch Logs  |---->|  UpdateDDB        |    |
|  | (API Calls) |     | (Trail Log Grp)  |     |  Lambda           |    |
|  +-------------+     +------------------+     +-------------------+    |
|        ^                                                               |
|        |                                                               |
|  CreateSubnet API Events                                               |
|                                                                        |
+------------------------------------------------------------------------+
```

### Data Flow

1. **VPC Flow Logs** are captured and sent to a CloudWatch Logs group
2. A **Subscription Filter** triggers the Calculator Lambda on new log entries
3. The **Calculator Lambda** looks up AZ information from DynamoDB and emits cross-AZ transfer metrics
4. **CloudTrail** captures CreateSubnet API calls
5. The **UpdateDDB Lambda** updates DynamoDB with new subnet-to-AZ mappings
6. On initial deployment, **LoadDDB Lambda** populates existing subnet data

## Multi-Account (Hub-Spoke) Architecture

In a multi-account deployment, spoke accounts send flow logs to a central hub for processing.

```
                    +------------------------------------------+
                    |           Hub Account                    |
                    |                                          |
                    |  +------------+    +------------------+  |
                    |  |  Kinesis   |--->|  Calculator      |  |
                    |  |  Stream    |    |  Lambda          |  |
                    |  +------------+    +------------------+  |
                    |        ^                  |              |
                    |        |                  v              |
                    |  +------------+    +------------------+  |
                    |  | CloudWatch |    |    DynamoDB      |  |
                    |  |   Logs     |    |  (AZsMapping)    |  |
                    |  | Destination|    +------------------+  |
                    |  +------------+           ^              |
                    |        ^                  |              |
                    +--------|------------------|---------------+
                             |                  |
         +-------------------|------------------|-----------------+
         |                   |                  |                  |
         v                   v                  v                  |
+----------------+   +----------------+   +----------------+       |
|  Spoke Acct 1  |   |  Spoke Acct 2  |   |  Spoke Acct N  |       |
+----------------+   +----------------+   +----------------+       |
|                |   |                |   |                |       |
| +------------+ |   | +------------+ |   | +------------+ |       |
| |  VPC(s)    | |   | |  VPC(s)    | |   | |  VPC(s)    | |       |
| | Flow Logs  | |   | | Flow Logs  | |   | | Flow Logs  | |       |
| +------------+ |   | +------------+ |   | +------------+ |       |
|       |        |   |       |        |   |       |        |       |
|       v        |   |       v        |   |       v        |       |
| +------------+ |   | +------------+ |   | +------------+ |       |
| | CloudWatch | |   | | CloudWatch | |   | | CloudWatch | |       |
| |   Logs     |-----|>|   Logs     |-----|>|   Logs     |---------+
| +------------+ |   | +------------+ |   | +------------+ |  To Hub
|                |   |                |   |                |
| +------------+ |   | +------------+ |   | +------------+ |
| | UpdateDDB  |-----|>| UpdateDDB  |-----|>| UpdateDDB  |-----+
| | Lambda     | |   | | Lambda     | |   | | Lambda     | |   |
| +------------+ |   | +------------+ |   | +------------+ |   |
+----------------+   +----------------+   +----------------+   |
                                                               |
                                                               v
                                                    Cross-Account Write
                                                    to Hub DynamoDB
```

### Hub Account Components

| Component | Description |
|-----------|-------------|
| **CloudWatch Logs Destination** | Receives logs from spoke accounts |
| **Kinesis Stream** | Aggregates flow logs from all spokes |
| **Calculator Lambda** | Processes flow logs and calculates cross-AZ transfer |
| **DynamoDB (AZsMapping)** | Central table storing subnet-to-AZ mappings |
| **DDB Role** | IAM role allowing spoke accounts to update DynamoDB |

### Spoke Account Components

| Component | Description |
|-----------|-------------|
| **VPC Flow Logs** | Captures network traffic from VPCs |
| **CloudWatch Logs** | Local flow log storage with subscription to hub |
| **CloudTrail** | Captures CreateSubnet events |
| **UpdateDDB Lambda** | Updates hub DynamoDB via cross-account role |
| **LoadDDB Lambda** | Initial data population via cross-account role |

## Cross-Account IAM Trust Relationships

The multi-account deployment requires specific IAM trust relationships:

```
+------------------+                      +------------------+
|   Hub Account    |                      |  Spoke Account   |
+------------------+                      +------------------+
|                  |                      |                  |
|  DDB Role        |<-----Assume Role-----|  UpdateDDB       |
|  (Trust: Spoke)  |                      |  Lambda          |
|                  |                      |                  |
|  CWL Destination |<--PutSubscription----|  CloudWatch      |
|  (Policy: Spoke) |     Filter           |  Logs            |
|                  |                      |                  |
|  PreRoles Stack  |                      |  PreRoles Stack  |
|  (in Hub)        |                      |  (in Spoke)      |
|                  |                      |                  |
+------------------+                      +------------------+
```

### IAM Trust Flow

1. **Hub DDB Role** trusts spoke account principals
2. Spoke **Lambda functions** assume the hub role to write to DynamoDB
3. **CloudWatch Logs Destination** policy allows spoke accounts to create subscription filters
4. **PreRolesStack** creates necessary execution roles in spoke accounts

## DynamoDB Table Schema

The AZsMapping table stores subnet-to-AZ mappings:

| Attribute | Type | Description |
|-----------|------|-------------|
| `AzId` | String (PK) | Availability Zone ID (e.g., `use1-az1`) |
| `VpcIdCidr` | String (SK) | VPC ID and CIDR (e.g., `vpc-123#10.0.1.0/24`) |
| `SubnetId` | String | Subnet ID |
| `AccountId` | String | AWS Account ID owning the subnet |

## Calculator Lambda Logic

The Calculator Lambda processes flow logs with the following logic:

1. **Decode and Parse**: Base64 decode and decompress CloudWatch log events
2. **Extract Fields**: Parse VPC flow log format (srcaddr, dstaddr, bytes, etc.)
3. **IP Lookup**: Query DynamoDB to find source and destination AZs from CIDR ranges
4. **Calculate Transfer**: If source and destination are in different AZs, record the transfer
5. **Emit Metrics**: Output JSON events for CloudWatch Contributor Insights

```
Flow Log Entry
     |
     v
+--------------------+
| Parse srcaddr,     |
| dstaddr, bytes     |
+--------------------+
     |
     v
+--------------------+
| Lookup srcaddr     |---> DynamoDB Query
| in DynamoDB        |
+--------------------+
     |
     v
+--------------------+
| Lookup dstaddr     |---> DynamoDB Query
| in DynamoDB        |
+--------------------+
     |
     v
+--------------------+
| Compare AZ IDs     |
| srcAZ != dstAZ?    |
+--------------------+
     |
     v (if different)
+--------------------+
| Emit JSON event:   |
| {srcIp, destIp,    |
|  srcAZ, destAZ,    |
|  bytes}            |
+--------------------+
```

## CloudWatch Contributor Insights

The solution is designed to work with CloudWatch Contributor Insights for visualization:

```
Calculator Lambda Output (JSON)
           |
           v
+------------------------+
| CloudWatch Logs        |
| (Lambda Log Group)     |
+------------------------+
           |
           v
+------------------------+
| Contributor Insights   |
| Rule:                  |
| - Contribution: srcIp, |
|   destIp               |
| - Aggregate: SUM(bytes)|
+------------------------+
           |
           v
+------------------------+
| Dashboard / Alarms     |
| - Top talkers          |
| - Transfer volume      |
| - Anomaly detection    |
+------------------------+
```

## Data Flow Summary

### Single-Account

```
VPC --> Flow Logs --> CW Logs --> Lambda --> DynamoDB --> Metrics
                                    ^
CloudTrail --> CW Logs --> Lambda --+
```

### Multi-Account

```
Spoke VPC --> Flow Logs --> CW Logs ------> Hub CW Dest --> Kinesis --> Lambda
                                                                          |
                                                              +-----------+
                                                              v
Spoke CloudTrail --> CW Logs --> Lambda --> (Assume Role) --> Hub DynamoDB
```

## Security Considerations

1. **Least Privilege**: Lambda roles have scoped permissions where possible
2. **Cross-Account Access**: Uses IAM roles with explicit trust policies
3. **Data in Transit**: All AWS service communications use TLS
4. **CloudTrail Logging**: All API calls are logged for audit
5. **VPC Flow Log Encryption**: CloudWatch Logs encrypted at rest
