import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as sfn from 'aws-cdk-lib/aws-stepfunctions'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import * as events from 'aws-cdk-lib/aws-events'

export class StepFunctionApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const apiConnection = new events.Connection(this, 'ApiConnection', {
      authorization: events.Authorization.apiKey('X-Dummy-Api-Key', cdk.SecretValue.unsafePlainText('none')) // No authorization required here,
    });

    const endpoint = 'https://api.github.com/users/eoinsha'

    const endState = new sfn.Pass(this, 'End')
    const apiState = new sfn.CustomState(this, 'API Invocation', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::http:invoke',
        Parameters: {
          ApiEndpoint: endpoint,
          Method: 'GET',
          Authentication: {
            ConnectionArn: apiConnection.connectionArn
          }
        },
        ResultSelector: {
          'profile.$': '$.ResponseBody',
        },
      }
    }).next(endState)
    const definition = new sfn.Pass(this, 'Pass')
    .next(new sfn.Choice(this, 'SkipChoice', { stateName: 'Skip API?'})
      .when(
        sfn.Condition.or(
          sfn.Condition.isNotPresent('$.querystring.skip'),
          sfn.Condition.not(sfn.Condition.stringEquals('$.querystring.skip', 'true'))
        ), apiState)
      .otherwise(endState)
    )

    const stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      definition,
      stateMachineType: sfn.StateMachineType.EXPRESS,
      tracingEnabled: true,
      logs: {
        destination: new logs.LogGroup(this, 'SfnLogGroup', {
          retention: logs.RetentionDays.ONE_DAY
        }),
        level: sfn.LogLevel.ALL,
        includeExecutionData: true
      }
    });
    stateMachine.role.attachInlinePolicy(new iam.Policy(this, 'HttpInvoke', {
      statements: [
        new iam.PolicyStatement({
          actions: ['states:InvokeHTTPEndpoint'],
          resources: [stateMachine.stateMachineArn],
          conditions: {
            'StringEquals': {
              'states:HTTPMethod': 'GET'
            },
            StringLike: {
              'states:HTTPEndpoint': `${endpoint}*`
            }
          }
        }),
        new iam.PolicyStatement({
          actions: ['events:RetrieveConnectionCredentials'],
          resources: [
            apiConnection.connectionArn,
          ],
        }),
        new iam.PolicyStatement({
          actions: [
            'secretsmanager:GetSecretValue',
            'secretsmanager:DescribeSecret',
          ],
          resources: [
            'arn:aws:secretsmanager:*:*:secret:events!connection/*',
          ],
        }),
      ]
    }))

    const api = new apigateway.StepFunctionsRestApi(this, 'Api', {
      stateMachine,
      deploy: true,
      deployOptions: {
        tracingEnabled: true
      }
    })
  }
}
