"use client";
import { useState, useEffect } from "react";
import Web3 from "web3";
import { Button } from "~/components/ui/button";
import { Calendar, ChevronDown, Phone, Mail } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Badge } from "~/components/ui/badge";
import { useToast } from "~/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import PatientRegistryABI from "./artifacts/PatientRegistry.json";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, query, orderByChild, equalTo } from "firebase/database";
import { useLoaderData } from "@remix-run/react";
import { firebaseConfig } from "firebaseConfig";
import CryptoJS from 'crypto-js';
import { json, LoaderFunction, redirect } from "@remix-run/node";
import { getAuth } from "@clerk/remix/ssr.server";
import { useUser } from "@clerk/remix";

export const loader: LoaderFunction = async (args) => {
  const { userId } = await getAuth(args);
  if (!userId) {
    return redirect('/sign-in');
  }
  return json({ firebaseConfig });
};

interface PatientData {
  firstName: string;
  lastName: string;
  age: number;
  gender: string;
  contactNumber: string;
  email: string;
  address: string;
  cancerType: string;
  diagnosedDate?: string;
  transactionHash?: string;
  [key: string]: any;
}

export default function FetchPatientData() {
  const { firebaseConfig } = useLoaderData<any>();
  const [patient, setPatient] = useState<PatientData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verificationResult, setVerificationResult] = useState<string>("");
  const [recordId, setRecordId] = useState<string>("");
  const { toast } = useToast();

  const app = initializeApp(firebaseConfig);
  const database = getDatabase(app);

  const [account, setAccount] = useState<string>('');
  const [patientRegistry, setPatientRegistry] = useState<any>(null);
  const { isLoaded, isSignedIn, user } = useUser();

  useEffect(() => {
    loadBlockchainData();
    if (isLoaded && isSignedIn && user) {
      fetchPatientData(user.id);
    }
    
  }, [isLoaded, isSignedIn, user]);

  const loadBlockchainData = async () => {
    if (window.ethereum) {
      const web3 = new Web3(window.ethereum);
      try {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        setAccount(accounts[0]);

        const networkId = await web3.eth.net.getId();
        const networkData = PatientRegistryABI.networks[networkId];

        if (networkData) {
          const registry = new web3.eth.Contract(PatientRegistryABI.abi, networkData.address);
          setPatientRegistry(registry);
        } else {
          window.alert('The smart contract is not deployed to the current network');
        }
      } catch (error) {
        console.error("User denied account access", error);
      }
    } else {
      window.alert("Non-Ethereum browser detected. You should consider trying MetaMask!");
    }
  };

  const fetchPatientData = async (userId: string) => {
    setLoading(true);
    setError(null);
    try {
      console.log("Fetching data for userId:", userId);
      const dbRef = query(ref(database, 'patients'), orderByChild('clerkId'), equalTo(userId));

      const snapshot = await get(dbRef);
  
      if (snapshot.exists()) {
        const patientData = snapshot.val();
        console.log("Retrieved firebase data:", patientData);
  
        // Extract the first key from the data object
        const recordId = Object.keys(patientData)[0]; 
  
        if (patientRegistry) {
          const record = await patientRegistry.methods.getPatientRecord(recordId).call();
          console.log("timestamp:", record.timestamp)
          console.log("Retrieved blockchain data:", record);
          if (record) {
            patientData[recordId].diagnosedDate = new Date(record.timestamp * 1000).toLocaleString();

          }
        }
  
        setPatient(patientData[recordId]);
        setRecordId(recordId);
        toast({
          title: "Success",
          description: "User data retrieved successfully",
        });
      } else {
        setError("No patient found with the provided information");
        setPatient(null);
        toast({
          title: "Error",
          description: "No patient found with the provided information",
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error("Error fetching data:", err);
      setError("Error fetching patient record");
      toast({
        title: "Error",
        description: "Failed to fetch patient data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };
  

  const generateHash = (data: any) => {
    const relevantData = {
      firstName: data.firstName,
      lastName: data.lastName,
      contactNumber: data.contactNumber,
      gender: data.gender,
      cancerType: data.cancerType,
      age: data.age,
      email: data.email,
      timestamp: data.timestamp
    };

    const sortedData = Object.keys(relevantData).sort().reduce((result: any, key: string) => {
      result[key] = relevantData[key];
      return result;
    }, {});

    return CryptoJS.SHA256(JSON.stringify(sortedData)).toString();
  };

  const verifyDataIntegrity = async () => {
    if (!patientRegistry || !patient) return;

    try {
      const record = await patientRegistry.methods.getPatientRecord(recordId).call();
      console.log("Retrieved patient record from blockchain:", record);

      const storedHash = record.dataHash;
      console.log("Stored hash from blockchain:", storedHash);

      const currentHash = generateHash(patient);
      console.log("Computed hash from Firebase data:", currentHash);

      let resultMessage = '';

      if (storedHash === currentHash) {
        resultMessage += 'Data integrity verified: No alterations detected.';
      } else {
        resultMessage += 'Data integrity compromised: Alterations detected.';

        toast({
          title: "Data Integrity Compromised",
          description: "Alterations detected in the data.",
          variant: "destructive",
        });
      }
      resultMessage += `\nStored Hash in Blockchain: ${storedHash}\nComputed Hash from Database: ${currentHash}\n`;
      setVerificationResult(resultMessage);

    } catch (error) {
      console.error("Error verifying data integrity:", error);
      setVerificationResult('Error verifying data integrity.');
    }
  };

  return (
    <div className="container mx-auto p-4 space-y-6">
       
       {user && (
        <h1 className="text-xl font-bold">Welcome back, {user.firstName}!</h1>
      )}

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {patient && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div className="flex items-center space-x-4">
              <Avatar className="h-20 w-20">
                <AvatarImage alt={`${patient.firstName} ${patient.lastName}`} />
                <AvatarFallback>{patient.firstName?.[0]}{patient.lastName?.[0]}</AvatarFallback>
              </Avatar>
              <div>
                <CardTitle className="text-2xl">
                  {patient.firstName} {patient.lastName}
                </CardTitle>
                <CardDescription>
                  {patient.age} years old • {patient.gender}
                </CardDescription>
              </div>
            </div>
            
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center space-x-2 text-sm">
                  <Phone className="h-4 w-4" />
                  <span>{patient.contactNumber}</span>
                </div>
                <div className="flex items-center space-x-2 text-sm">
                  <Mail className="h-4 w-4" />
                  <span>{patient.email}</span>
                </div>
                <div className="flex items-center space-x-2 text-sm">
                  <Calendar className="h-4 w-4" />
                  <span className="text-sm font-medium">Diagnosed Date:</span>
                  <span className="text-sm">{patient.diagnosedDate || 'N/A'}</span>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Cancer Type:</span>
                  <Badge variant="secondary">{patient.cancerType}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Transaction Hash:</span>
                  <Badge variant="outline">{patient.transactionHash || 'N/A'}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Patient ID:</span>
                  <Badge variant="outline">{recordId}</Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {patient && (
        <Button onClick={verifyDataIntegrity} className="mt-6">
          Verify Data Integrity
        </Button>
      )}

      {verificationResult && (
        <div className="mt-4 p-4 bg-gray-100 border rounded" style={{ whiteSpace: 'pre-wrap' }}>
          {verificationResult}
        </div>
      )}
    </div>
  );
}
