import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as eks from "@pulumi/eks";
import * as random from "@pulumi/random";
import * as k8s from "@pulumi/kubernetes";
import S3ServiceAccount from "./S3ServiceAccount";
import TraefikRoute from './TraefikRoute'


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
    engineVersion: "11.10",
    instanceClass: "db.t3.medium",
    name: "mlflow",
    password: mlflowDBPassword.result,
    skipFinalSnapshot: true,
    username: "postgres",

    //Make sure that our EKS cluster has access to the MLFlow DB
    vpcSecurityGroupIds: [cluster.clusterSecurityGroup.id, cluster.nodeSecurityGroup.id],
});

//Create the artifact store for MLFlow (S3 bucket)
const artifactStorage = new aws.s3.Bucket("artifact-storage", {
    acl : "public-read-write"
});



//Install MLFlow
// Service account for models with read only access to models
const mlflowServiceAccount = new S3ServiceAccount('mlflow-service-account', {
    namespace: 'default',
    oidcProvider: cluster.core.oidcProvider!,
    readOnly: false,
  }, { provider: cluster.provider });

  
const mlflow = new k8s.helm.v3.Chart("mlflow", {
    chart: "mlflow",
    values : {
        "backendStore": {
          "postgres": {
            "username": mlflowDB.username,
            "password": mlflowDB.password,
            "host": mlflowDB.address,
            "port": mlflowDB.port,
            "database": "mlflow"
          }
        },
        "defaultArtifactRoot": artifactStorage.bucket.apply((bucketName: string) => `s3://${bucketName}`),
        "serviceAccount":{
            "create" : false,
            "name" : mlflowServiceAccount.name,
        }
      },
    fetchOpts:{
        repo: "https://larribas.me/helm-charts",
    },
},{provider : cluster.provider});

//Install traefik
const traefik = new k8s.helm.v3.Chart("traefik", {
    chart: "traefik",
    fetchOpts:{
        repo: "https://helm.traefik.io/traefik",
    },
},{provider : cluster.provider});


//Make sure each request that starts with /mlflow is routed to MLFlow
//Expose MLFlow in Traefik as /mlflow 
new TraefikRoute('mlflow-route', {
    prefix: '/mlflow',
    service: mlflow.getResource('v1/Service', 'mlflow'),
    namespace: 'default',
  }, { provider: cluster.provider});



//Setting the zone
const selected = aws.route53.getZone({
    name: "aebono.com",
    privateZone: false,
});
  
//Make sure that ml.aporia.com is routed to Traefik
//TODO : Buy domain and hosted from aebono.com
new aws.route53.Record("dns-record", {
    zoneId: selected.then(selected => selected.zoneId),
    name: selected.then(selected => `ml.${selected.name}`),
    type: "CNAME",
    ttl: 300,
    records: [traefik.getResource('v1/Service', 'traefik').status.loadBalancer.ingress[0].hostname],
});


// Export the cluster's kubeconfig.
export const kubeconfig = cluster.kubeconfig;
