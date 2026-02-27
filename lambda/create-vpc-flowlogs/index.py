"""
VPC Flow Logs Creator Custom Resource Lambda Function

This Lambda function is a CloudFormation custom resource that creates,
updates, and deletes VPC Flow Logs for specified VPCs. It sends flow
logs to CloudWatch Logs for processing.

Handler: lambda_handler
Runtime: Python 3.11+
"""
from __future__ import annotations

import json
from typing import Any, Literal

import boto3
import botocore.exceptions
import urllib3

# Response status constants
SUCCESS: Literal["SUCCESS"] = "SUCCESS"
FAILED: Literal["FAILED"] = "FAILED"

# HTTP client for CloudFormation callback
http = urllib3.PoolManager()

# EC2 client
ec2 = boto3.client('ec2')


def send_cfn_response(
    event: dict[str, Any],
    context: Any,
    response_status: str,
    response_data: dict[str, Any],
    reason: str | None = None,
    physical_resource_id: str | None = None,
    no_echo: bool = False
) -> None:
    """
    Send response back to CloudFormation for custom resource.
    
    Args:
        event: The CloudFormation custom resource event.
        context: The Lambda context object.
        response_status: SUCCESS or FAILED.
        response_data: Data to return to CloudFormation.
        reason: Optional reason for the response.
        physical_resource_id: Optional physical resource ID.
        no_echo: Whether to mask the response in CloudFormation.
    """
    response_url = event['ResponseURL']
    print(f"Response URL: {response_url}")
    
    log_stream_name = getattr(context, 'log_stream_name', 'unknown')
    
    response_body = {
        'Status': response_status,
        'Reason': reason or f"See CloudWatch Log Stream: {log_stream_name}",
        'PhysicalResourceId': physical_resource_id or log_stream_name,
        'StackId': event['StackId'],
        'RequestId': event['RequestId'],
        'LogicalResourceId': event['LogicalResourceId'],
        'NoEcho': no_echo,
        'Data': response_data
    }
    
    json_response_body = json.dumps(response_body)
    print(f"Response body: {json_response_body}")
    
    headers = {
        'content-type': '',
        'content-length': str(len(json_response_body))
    }
    
    try:
        response = http.request(
            'PUT',
            response_url,
            headers=headers,
            body=json_response_body
        )
        print(f"Status code: {response.status}")
    except Exception as e:
        print(f"Failed to send response to CloudFormation: {e}")


def create_vpc_flow_logs(
    vpc_ids: list[str],
    log_group_arn: str,
    vpc_flow_log_publish_role: str
) -> dict[str, Any]:
    """
    Create VPC Flow Logs for the specified VPCs.
    
    Args:
        vpc_ids: List of VPC IDs to enable flow logs for.
        log_group_arn: ARN of the CloudWatch Log Group destination.
        vpc_flow_log_publish_role: IAM role ARN for publishing logs.
        
    Returns:
        The create_flow_logs API response.
        
    Raises:
        botocore.exceptions.ClientError: If flow log creation fails.
    """
    print(f"Creating flow logs for VPCs: {vpc_ids}")
    
    response = ec2.create_flow_logs(
        DeliverLogsPermissionArn=vpc_flow_log_publish_role,
        ResourceIds=vpc_ids,
        ResourceType='VPC',
        TrafficType='ACCEPT',
        LogDestinationType='cloud-watch-logs',
        LogDestination=log_group_arn
    )
    
    print(f"Created flow logs: {response}")
    return response


def delete_vpc_flow_logs(vpc_ids: list[str]) -> dict[str, Any] | None:
    """
    Delete VPC Flow Logs for the specified VPCs.
    
    Args:
        vpc_ids: List of VPC IDs to delete flow logs for.
        
    Returns:
        The delete_flow_logs API response, or None if no flow logs exist.
        
    Raises:
        botocore.exceptions.ClientError: If flow log deletion fails.
    """
    print(f"Deleting flow logs for VPCs: {vpc_ids}")
    
    # Find existing flow logs for these VPCs
    flow_log_response = ec2.describe_flow_logs(
        Filter=[{'Name': 'resource-id', 'Values': vpc_ids}]
    )
    
    flow_log_ids = [
        flow_log['FlowLogId']
        for flow_log in flow_log_response.get('FlowLogs', [])
    ]
    
    if not flow_log_ids:
        print("No existing flow logs found to delete")
        return None
    
    print(f"Deleting flow log IDs: {flow_log_ids}")
    response = ec2.delete_flow_logs(FlowLogIds=flow_log_ids)
    
    print(f"Deleted flow logs: {response}")
    return response


def lambda_handler(event: dict[str, Any], context: Any) -> None:
    """
    CloudFormation custom resource handler for VPC Flow Logs.
    
    Handles Create, Update, and Delete requests from CloudFormation
    to manage VPC Flow Logs lifecycle.
    
    Args:
        event: The CloudFormation custom resource event.
        context: The Lambda context object.
    """
    response_data: dict[str, Any] = {}
    physical_resource_id = "createVPCFlowLogs"
    
    print(f"REQUEST BODY: {json.dumps(event)}")
    
    # Extract resource properties
    resource_props = event.get('ResourceProperties', {})
    vpc_ids: list[str] = resource_props.get('VpcIds', [])
    log_group_arn: str = resource_props.get('LogGroupArn', '')
    vpc_flow_log_publish_role: str = resource_props.get('VpcFlogLogPublishRole', '')
    
    request_type = event['RequestType']
    
    match request_type:
        case "Create":
            try:
                create_vpc_flow_logs(vpc_ids, log_group_arn, vpc_flow_log_publish_role)
                response_status = SUCCESS
            except botocore.exceptions.ClientError as e:
                print(f"Error creating flow logs: {e}")
                response_status = FAILED
                response_data['Error'] = str(e)
                
        case "Update":
            old_resource_props = event.get('OldResourceProperties', {})
            old_vpc_ids: list[str] = old_resource_props.get('VpcIds', [])
            
            try:
                # Delete old flow logs first
                delete_vpc_flow_logs(old_vpc_ids)
                # Create new flow logs
                create_vpc_flow_logs(vpc_ids, log_group_arn, vpc_flow_log_publish_role)
                response_status = SUCCESS
            except botocore.exceptions.ClientError as e:
                print(f"Error updating flow logs: {e}")
                response_status = FAILED
                response_data['Error'] = str(e)
                
        case "Delete":
            try:
                delete_vpc_flow_logs(vpc_ids)
                response_status = SUCCESS
            except botocore.exceptions.ClientError as e:
                print(f"Error deleting flow logs: {e}")
                response_status = FAILED
                response_data['Error'] = str(e)
                
        case _:
            print(f"Unknown request type: {request_type}")
            response_status = FAILED
            response_data['Error'] = f"Unknown request type: {request_type}"
    
    send_cfn_response(
        event,
        context,
        response_status,
        response_data,
        physical_resource_id=physical_resource_id
    )
