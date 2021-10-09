import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as eks from "@pulumi/eks";
import * as random from "@pulumi/random";


// Create an EKS cluster with the default configuration.
const cluster = new eks.Cluster("ml-cluster" , {
    createOidcProvider : true, 
});

//Create random password for postgreSQL 
const mlflowDBPassword = new random.RandomPassword("password", {
    length: 16,
    special: false,
});

// Create Postgres DB for Model Metadata in MLFlow
const mlflowDB = new aws.rds.Instance("mlflow-db", {
    allocatedStorage: 32, //GB
    engine: "postgres",
    engineVersion: "5.7",
    instanceClass: "db.t3.medium",
    name: "mlflow",
    password: mlflowDBPassword.result,
    skipFinalSnapshot: true,
    username: "postgres",

    //Make sure that our EKS cluster has access to the MLFlow DB
    vpcSecurityGroupIds: [cluster.clusterSecurityGroup.id, cluster.nodeSecurityGroup.id],
});

// Export the cluster's kubeconfig.
export const kubeconfig = cluster.kubeconfig;
